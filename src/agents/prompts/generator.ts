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

GROUP RELATED REQUIREMENTS INTO ONE TOPIC. This is the most important rule.

A topic is a coherent study session, not a checkbox against the job ad. Requirements
that would be studied together, revised together, and asked about in the same
interview answer belong in ONE topic:

- "embeddings" + "vector databases" + "pgvector" + "RAG systems"
    -> one topic: retrieval-augmented-generation
- "PostgreSQL" + "query optimisation"
    -> one topic: postgresql
- "LLM evaluation" + "test sets" + "LLM-as-judge" + "prompt versioning"
    -> one topic: llm-evaluation
- "algorithmic problem solving" + "data structures"
    -> one topic: data-structures-and-algorithms

A plan with one topic per bullet in the job ad is a BAD plan. Expect roughly 5-9
topics for a typical offer. If you produce more than 10, you are listing
requirements rather than planning study.

Other rules:
- Grounded in the offer: every topic must trace to stated requirements. Do not add
  topics because they are fashionable or adjacent.
- Sized honestly: estimatedCards reflects how much there is worth memorising, not a
  uniform number. A peripheral "nice to have" may deserve 2; a core daily requirement
  may deserve 12.
- Skip requirements that cannot be studied as knowledge: years of experience, domain
  familiarity ("insurance domain"), and soft attributes produce no useful flashcards.

For each topic list the atomic concepts a candidate must be able to explain. These
drive the cards, so make them specific: "useEffect cleanup functions and when they
run" rather than "hooks basics". When a topic merges several requirements, its
concepts should cover all of them.

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
good cards, write three — the requested count is a ceiling, not a quota.

LANGUAGE: always write cards in English, even when the source material is in another
language. The corpus is mixed-language; the card library is not. Translate the meaning
faithfully — do not invent detail to smooth over a passage you found ambiguous, and
keep technical terms in their standard English form (not literal translations).`;

export function writerPrompt(topic: PlanTopic, sources: string): string {
  return `Write flashcards for the topic "${topic.name}" (slug: ${topic.slug}).

Concepts to cover:
${topic.concepts.map((c) => `- ${c}`).join('\n')}

Write at most ${topic.estimatedCards} cards. Use topicSlug "${topic.slug}" on every card.

Cite sources exactly as identified below:
- corpus sections by their id, shown as (section:<id>) — use kind "corpus";
- external sources by their full URL, shown as (url:<...>) — use the kind shown in
  that source's header (web, stackoverflow, or context7).
Cite only sources listed below; never invent an id or URL. Corpus sections are the
preferred basis when both cover a concept.

--- SOURCES ---
${sources}
--- END SOURCES ---`;
}

/** Shown to the Writer when the corpus returned nothing usable for a topic. */
export const NO_SOURCES_NOTE =
  'No corpus material was found for this topic. Write no cards — returning an empty ' +
  'array is correct here, because a card without a source cannot be verified.';

/**
 * Layer 4: the Writer works from a Researcher's synthesized note, never from raw
 * sections. Citation refs come from the note's inline (section:...)/(url:...) markers.
 */
export function writerFromNotePrompt(topic: PlanTopic, noteContent: string): string {
  return `Write flashcards for the topic "${topic.name}" (slug: ${topic.slug}).

Concepts to cover:
${topic.concepts.map((c) => `- ${c}`).join('\n')}

Write at most ${topic.estimatedCards} cards. Use topicSlug "${topic.slug}" on every card.

Your ONLY source is the research note below. Its facts carry inline citations like
(section:<id>) or (url:<...>) — copy the citation(s) a card's answer is based on into
that card's provenance, using the ref exactly as written. Skip anything the note marks
NOT COVERED.

--- RESEARCH NOTE ---
${noteContent}
--- END NOTE ---`;
}

/** Revision pass: the Critic rejected specific cards; fix only those. */
export function writerRevisionPrompt(
  topic: PlanTopic,
  noteContent: string,
  rejected: { front: string; back: string; reason: string; note: string }[],
): string {
  return `Some of your flashcards for "${topic.name}" (slug: ${topic.slug}) were rejected in review.
Rewrite each one to fix the stated problem, using ONLY the research note below. If a
card cannot be fixed from the note (e.g. the underlying fact is not there), drop it —
return fewer cards rather than an unfixable one.

Rejected cards:
${rejected
  .map((r, i) => `${i + 1}. reason: ${r.reason} — ${r.note}\n   Q: ${r.front}\n   A: ${r.back}`)
  .join('\n')}

Citation rules as before: copy (section:<id>)/(url:<...>) refs from the note into
provenance exactly as written.

--- RESEARCH NOTE ---
${noteContent}
--- END NOTE ---`;
}
