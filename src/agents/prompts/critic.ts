import type { DraftCard } from '../contracts';

/**
 * Critic rubric prompt (Layer 4). Dedup happens in code before this; the LLM only
 * judges quality, on the narrow rubric the schema can express.
 */

export const CRITIC_SYSTEM = `You review flashcards against a strict rubric before they reach a human.

For each card, judge:
- not_atomic: the card tests more than one fact/concept, or the question is too broad
  to have one correct answer.
- answer_leaks: the front gives away the answer (fully or mostly).
- incorrect: the back contains a factual error or contradicts itself.
- no_source: the back plainly goes beyond anything its cited provenance could support
  (you cannot see the sources — flag only clear overreach like specific numbers,
  benchmarks or version claims presented without any citation).

Accept a card unless it clearly violates the rubric — the human reviewer makes the
final call; your job is to catch defects, not to impose taste. When you reject, the
note must say exactly what to fix in one sentence.

Return indices relative to the numbered list you are given.`;

export function criticPrompt(drafts: DraftCard[]): string {
  return `Review these ${drafts.length} flashcards. Return accepted indices and rejected
indices with reasons (indices are 0-based, matching the numbering below).

${drafts
  .map(
    (card, i) => `[${i}] (${card.kind}) topic:${card.topicSlug}
  Q: ${card.front}
  A: ${card.back}
  cites: ${card.provenance.length} source(s)`,
  )
  .join('\n\n')}`;
}
