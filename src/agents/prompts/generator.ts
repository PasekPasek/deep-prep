import type { ExtractedOffer, PlanTopic } from '../contracts';

/**
 * Layer 1 collapses Planner + Researcher + Writer into one agent, so there are two
 * prompts: one that plans topics from requirements, one that writes cards for a single
 * topic from retrieved corpus sections.
 *
 * They are kept separate (rather than one mega-prompt) because Layer 4 splits them
 * across real sub-agents — at which point these move as-is.
 */

export const PLANNER_SYSTEM = `You turn job requirements into a study plan for interview preparation.

Produce topics that are:
- Coherent: one technology or concept area per topic ("react-hooks", not "frontend").
- Grounded in the offer: every topic must trace to a stated requirement. Do not add
  topics because they are fashionable or adjacent.
- Sized honestly: estimatedCards should reflect how much there is worth memorising,
  not a uniform number. A peripheral "nice to have" may deserve 2 cards; a core daily
  requirement may deserve 12.

For each topic list the atomic concepts a candidate must be able to explain. These
drive the cards, so make them specific: "useEffect cleanup functions and when they
run" rather than "hooks basics".

prerequisites name other topics in this plan that should be studied first; use their
slugs, and leave the array empty when there are none.

Prioritise mustHave over niceToHave. Weight toward the stated seniority: a senior role
warrants depth and trade-offs, a junior role warrants fundamentals.

Slugs are lowercase kebab-case.`;

export function plannerPrompt(offer: ExtractedOffer): string {
  return `Plan interview-prep topics for this role.

Company: ${offer.company}
Role: ${offer.role}
Seniority: ${offer.seniority}
${offer.domain ? `Domain: ${offer.domain}\n` : ''}
Required:
${offer.mustHave.map((r) => `- ${r}`).join('\n') || '- (none stated)'}

Nice to have:
${offer.niceToHave.map((r) => `- ${r}`).join('\n') || '- (none stated)'}`;
}

export const WRITER_SYSTEM = `You write spaced-repetition flashcards from source material.

Hard rules — a card violating any of these is worthless and must not be produced:

1. ONE card = ONE atomic fact or concept. If a card needs "and" to describe what it
   tests, split it. When in doubt, split.
2. The front must NOT leak the answer. No "Explain how useEffect cleanup prevents
   memory leaks" — that states the answer inside the question.
3. The back must be derivable from the provided sources. Do not add facts from your own
   knowledge, however confident you are. If the sources do not support a card, do not
   write that card.
4. Every card carries provenance: the section ids you actually used for it. Never cite
   a section you did not draw from.
5. The back is concise and complete: what a strong candidate would say, not an essay.
   Two to four sentences for concepts. Include a short code snippet only when the
   concept is inherently syntactic.

Card kinds:
- concept: tests understanding of an idea.
- interview_question: front phrased as a real interviewer would ask it; back is a
  strong spoken answer.
- coding_task: a small concrete problem; back gives the approach and key code.

Prefer fewer excellent cards to more mediocre ones. If the sources only support three
good cards, write three — the requested count is a ceiling, not a quota.`;

export function writerPrompt(topic: PlanTopic, sources: string): string {
  return `Write flashcards for the topic "${topic.name}" (slug: ${topic.slug}).

Concepts to cover:
${topic.concepts.map((c) => `- ${c}`).join('\n')}

Write at most ${topic.estimatedCards} cards. Use topicSlug "${topic.slug}" on every card.

Cite sources by their section id, shown as (section:<id>) in each heading below. Use
kind "corpus" for these.

--- SOURCES ---
${sources}
--- END SOURCES ---`;
}

/** Shown to the Writer when the corpus returned nothing usable for a topic. */
export const NO_SOURCES_NOTE =
  'No corpus material was found for this topic. Write no cards — returning an empty ' +
  'array is correct here, because a card without a source cannot be verified.';
