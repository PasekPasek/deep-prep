import 'server-only';

import { z } from 'zod';

import { callAgent, type CallMeta } from './call';
import { DraftCard, type PlanTopic, type Provenance, type ResearchNote } from './contracts';
import { WRITER_SYSTEM, writerFromNotePrompt, writerRevisionPrompt } from './prompts/generator';

/**
 * Writer (Layer 4): topic + research note → DraftCard[].
 *
 * Context isolation: the Writer sees the note and nothing else — not the offer, not
 * the raw sections, not other topics' notes. Card provenance may only reference refs
 * present in the note's own provenance, enforced here in code.
 */

const WriterOutput = z.object({
  cards: z.array(
    DraftCard.omit({ topicSlug: true }).extend({
      provenance: z.array(z.object({ kind: z.string(), ref: z.string() })),
    }),
  ),
});

export type WriteResult = {
  cards: DraftCard[];
  costUsd: number;
  dropped: { front: string; reason: string }[];
};

function harvestCards(
  raw: z.infer<typeof WriterOutput>['cards'],
  topic: PlanTopic,
  note: ResearchNote,
): { cards: DraftCard[]; dropped: WriteResult['dropped'] } {
  const allowed = new Map(note.provenance.map((p) => [p.ref, p]));
  const cards: DraftCard[] = [];
  const dropped: WriteResult['dropped'] = [];

  for (const card of raw) {
    const cited: Provenance[] = [];
    const seen = new Set<string>();
    for (const p of card.provenance) {
      const match = allowed.get(p.ref);
      if (match && !seen.has(p.ref)) {
        seen.add(p.ref);
        cited.push(match);
      }
    }
    if (cited.length === 0) {
      dropped.push({ front: card.front, reason: 'cited nothing from the research note' });
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
  return { cards, dropped };
}

export async function writeFromNote(
  topic: PlanTopic,
  note: ResearchNote,
  meta: CallMeta = {},
): Promise<WriteResult> {
  const result = await callAgent({
    role: 'writer',
    schema: WriterOutput,
    system: WRITER_SYSTEM,
    prompt: writerFromNotePrompt(topic, note.content),
    meta: { ...meta, topicSlug: topic.slug },
  });

  const { cards, dropped } = harvestCards(result.value.cards, topic, note);
  return { cards, costUsd: result.costUsd, dropped };
}

/** Revision pass for cards the Critic rejected. May return fewer cards than rejects. */
export async function reviseRejected(
  topic: PlanTopic,
  note: ResearchNote,
  rejected: { front: string; back: string; reason: string; note: string }[],
  meta: CallMeta = {},
): Promise<WriteResult> {
  const result = await callAgent({
    role: 'writer',
    schema: WriterOutput,
    system: WRITER_SYSTEM,
    prompt: writerRevisionPrompt(topic, note.content, rejected),
    meta: { ...meta, topicSlug: topic.slug },
  });

  const { cards, dropped } = harvestCards(result.value.cards, topic, note);
  return { cards, costUsd: result.costUsd, dropped };
}
