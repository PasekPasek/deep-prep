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
import type { PlanTopic, Provenance, ResearchNote } from './contracts';
import { RESEARCHER_SYSTEM, researcherPrompt } from './prompts/researcher';

/**
 * Researcher (Layer 4): one topic → retrieval cascade → synthesized ResearchNote.
 *
 * The note is the ONLY thing the Writer will see for this topic (context isolation,
 * §5.0a) — raw sections never travel further than this agent. Provenance on the note
 * is code-enforced the same way card provenance is: only refs that were actually
 * retrieved survive.
 */

const TOP_K = 8;
/** Below this many usable sections, coverage is thin and the web cascade fires. */
const THIN_COVERAGE = 3;
/**
 * Below this cosine similarity a "hit" is noise. Calibrated against the live corpus,
 * not guessed: covered topics score 0.51–0.63, while an uncovered topic ("React
 * hooks", absent from both sources) tops out at 0.298 on unrelated sections. 0.35
 * sits in the empty band between the two.
 */
const MIN_SIMILARITY = 0.35;

const NoteOutput = z.object({
  content: z.string(),
});

export type ResearchResult = {
  note: ResearchNote | null;
  costUsd: number;
  sectionsFound: number;
  externalFound: number;
};

export async function researchTopic(topic: PlanTopic, meta: CallMeta = {}): Promise<ResearchResult> {
  const query = `${topic.name}. ${topic.concepts.join('. ')}`;
  const hits = (await multilingualSearch(query, TOP_K, meta)).filter(
    (h) => h.similarity >= MIN_SIMILARITY,
  );

  let external: ExternalSource[] = [];
  if (hits.length < THIN_COVERAGE) {
    external = (await webFallback(topic)).sources;
  }

  if (hits.length === 0 && external.length === 0) {
    return { note: null, costUsd: 0, sectionsFound: 0, externalFound: 0 };
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
    role: 'researcher',
    schema: NoteOutput,
    system: RESEARCHER_SYSTEM,
    prompt: researcherPrompt(topic, sourcesBlock),
    meta: { ...meta, topicSlug: topic.slug },
  });

  // The note cites inline as (section:<id>) / (url:<...>). Provenance for the note is
  // the set of retrieved sources it actually references — parsed out and validated
  // against what retrieval returned, never trusted from generation.
  const provenance: Provenance[] = [];
  const seen = new Set<string>();
  for (const match of result.value.content.matchAll(/\((?:section|url):([^)\s]+)\)/g)) {
    const ref = match[1];
    if (seen.has(ref)) continue;
    seen.add(ref);
    const section = hits.find((h) => h.sectionId === ref);
    if (section) {
      provenance.push(toProvenance(section));
      continue;
    }
    const ext = external.find((s) => s.url === ref);
    if (ext) provenance.push(externalToProvenance(ext));
  }

  // A note citing nothing that was actually retrieved is untrustworthy end to end.
  if (provenance.length === 0) {
    return { note: null, costUsd: result.costUsd, sectionsFound: hits.length, externalFound: external.length };
  }

  return {
    note: { topicSlug: topic.slug, content: result.value.content, provenance },
    costUsd: result.costUsd,
    sectionsFound: hits.length,
    externalFound: external.length,
  };
}
