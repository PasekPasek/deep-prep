import 'server-only';

import { z } from 'zod';

import { multilingualSearch } from '@/retrieval/multilingualSearch';
import { renderForPrompt, toProvenance } from '@/retrieval/semanticSearch';
import {
  externalToProvenance,
  renderExternalForPrompt,
  webFallback,
  type ExternalSource,
} from '@/retrieval/webFallback';

import { callAgent, type CallMeta } from './call';
import { clampEstimatedCards, DraftCard, Plan, type ExtractedOffer, type PlanTopic } from './contracts';
import { PLANNER_SYSTEM, plannerPrompt, WRITER_SYSTEM, writerPrompt } from './prompts/generator';

/**
 * Layer 1's single generation agent: plan topics, then research and write each topic
 * from the corpus.
 *
 * The two halves are separate exported functions rather than one call, because the
 * orchestrator checkpoints between them and resumes mid-topic. Layer 4 promotes them
 * to real sub-agents without changing either signature.
 */

const TOP_K = 8;
/**
 * Corpus coverage below this many usable sections counts as "thin" and triggers the
 * external cascade (§7.1 step 4). Corpus is always consulted first; the web fills
 * gaps, it does not compete.
 */
const THIN_COVERAGE = 3;
/**
 * Below this cosine similarity a "hit" is noise that would only mislead the Writer.
 *
 * Calibrated against the live corpus rather than guessed: queries the corpus genuinely
 * covers score 0.51-0.61 ("system design interview" 0.556, "negotiating an offer"
 * 0.547, "dynamic programming" 0.606), while a query it does NOT cover ("React hooks
 * and useEffect cleanup", absent from an interview-process handbook) topped out at
 * 0.298 with unrelated sections. 0.35 sits in the empty band between the two, so an
 * uncovered topic yields no cards instead of confidently wrong ones.
 */
const MIN_SIMILARITY = 0.35;

export async function planTopics(offer: ExtractedOffer, meta: CallMeta = {}) {
  const result = await callAgent({
    role: 'planner',
    schema: Plan,
    system: PLANNER_SYSTEM,
    prompt: plannerPrompt(offer),
    meta,
  });

  // The card-count bound cannot be expressed in the schema (see contracts.ts), so it
  // is enforced here instead.
  return {
    ...result,
    value: {
      topics: result.value.topics.map((topic) => ({
        ...topic,
        estimatedCards: clampEstimatedCards(topic.estimatedCards),
      })),
    },
  };
}

/** The Writer returns cards; topicSlug and provenance are re-derived in code below. */
const WriterOutput = z.object({
  cards: z.array(
    DraftCard.omit({ topicSlug: true }).extend({
      provenance: z.array(z.object({ kind: z.string(), ref: z.string() })),
    }),
  ),
});

export type TopicResult = {
  cards: DraftCard[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Sections consulted, for the run log and for explaining an empty result. */
  sectionsFound: number;
  /** External sources consulted when corpus coverage was thin (Layer 3). */
  externalFound: number;
  dropped: { front: string; reason: string }[];
};

/**
 * Research one topic against the corpus and write its cards.
 *
 * Returns no cards rather than ungrounded cards when the corpus has nothing: a card
 * without provenance cannot be verified, and the Critic would reject it anyway.
 */
export async function writeCardsForTopic(
  topic: PlanTopic,
  meta: CallMeta = {},
): Promise<TopicResult> {
  const query = `${topic.name}. ${topic.concepts.join('. ')}`;
  const hits = (await multilingualSearch(query, TOP_K, meta)).filter(
    (h) => h.similarity >= MIN_SIMILARITY,
  );

  // §7.1: corpus first, always. The cascade only fills thin coverage, and only up to
  // its per-topic call budget.
  let external: ExternalSource[] = [];
  if (hits.length < THIN_COVERAGE) {
    const fallback = await webFallback(topic);
    external = fallback.sources;
  }

  if (hits.length === 0 && external.length === 0) {
    return {
      cards: [],
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      sectionsFound: 0,
      externalFound: 0,
      dropped: [],
    };
  }

  const sourcesBlock = [
    hits.length > 0 ? renderForPrompt(hits) : null,
    external.length > 0
      ? `--- EXTERNAL SOURCES (web) ---\n\n${renderExternalForPrompt(external)}`
      : null,
  ]
    .filter(Boolean)
    .join('\n\n');

  const result = await callAgent({
    role: 'writer',
    schema: WriterOutput,
    system: WRITER_SYSTEM,
    prompt: writerPrompt(topic, sourcesBlock),
    meta: { ...meta, topicSlug: topic.slug },
  });

  // Provenance is enforced in code, not trusted from the model. A card may only cite
  // sources actually retrieved for this topic — corpus sections by id, external
  // sources by their exact URL. Anything else is dropped with a reason.
  const allowedSections = new Map(hits.map((h) => [h.sectionId, h]));
  const allowedExternal = new Map(external.map((s) => [s.url, s]));
  const cards: DraftCard[] = [];
  const dropped: TopicResult['dropped'] = [];

  for (const card of result.value.cards) {
    const cited = card.provenance.flatMap((p) => {
      const section = allowedSections.get(p.ref);
      if (section) return [toProvenance(section)];
      const ext = allowedExternal.get(p.ref);
      if (ext) return [externalToProvenance(ext)];
      return [];
    });

    if (cited.length === 0) {
      dropped.push({
        front: card.front,
        reason: 'cited no source retrieved for this topic',
      });
      continue;
    }

    cards.push({
      topicSlug: topic.slug,
      kind: card.kind,
      front: card.front,
      back: card.back,
      provenance: cited,
    });
  }

  return {
    cards,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: result.costUsd,
    sectionsFound: hits.length,
    externalFound: external.length,
    dropped,
  };
}
