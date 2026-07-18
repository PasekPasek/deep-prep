import { z } from 'zod';

/**
 * Every inter-agent hand-off in the pipeline, as Zod schemas.
 *
 * These ARE the contracts: agents never pass raw strings or loosely-shaped objects to
 * each other. Each LLM call validates its output against one of these, and the
 * orchestrator gets one repair attempt before failing the run.
 *
 * Schemas for later layers (ResearchNote, CriticVerdict) are defined now so the
 * multi-agent split in Layer 4 does not restate them and drift.
 */

export const Seniority = z.enum(['junior', 'mid', 'senior', 'staff', 'unknown']);

export const ExtractedOffer = z.object({
  company: z.string(),
  role: z.string(),
  seniority: Seniority,
  mustHave: z.array(z.string()),
  niceToHave: z.array(z.string()),
  domain: z.string().optional(),
});
export type ExtractedOffer = z.infer<typeof ExtractedOffer>;

/**
 * IMPORTANT — do not add `.int()` or numeric bounds to any schema sent to a model.
 *
 * Anthropic's structured output rejects `minimum`/`maximum` on integer properties:
 *   "[Anthropic] output_config.format.schema: For 'integer' type, properties maximum,
 *    minimum are not supported"
 *
 * and Zod 4 emits those bounds *automatically* for `.int()` — it renders as
 * `{"type":"integer","minimum":-9007199254740991,"maximum":9007199254740991}`, the JS
 * safe-integer range. So a bare `.int()` with no explicit constraints is enough to
 * fail the call. This cost two failed Planner runs before the cause was visible.
 *
 * Use plain `z.number()`, state the expectation in `.describe()`, and enforce the real
 * constraint in code after parsing.
 */
export const MIN_CARDS_PER_TOPIC = 1;
export const MAX_CARDS_PER_TOPIC = 15;

export const PlanTopic = z.object({
  slug: z.string(),
  name: z.string(),
  /** Atomic concepts to cover — these drive how many cards the topic yields. */
  concepts: z.array(z.string()),
  prerequisites: z.array(z.string()),
  estimatedCards: z
    .number()
    .describe(`Whole number of cards this topic warrants, ${MIN_CARDS_PER_TOPIC}-${MAX_CARDS_PER_TOPIC}`),
});

export function clampEstimatedCards(value: number): number {
  return Math.min(MAX_CARDS_PER_TOPIC, Math.max(MIN_CARDS_PER_TOPIC, Math.round(value)));
}
export type PlanTopic = z.infer<typeof PlanTopic>;

export const Plan = z.object({
  topics: z.array(PlanTopic),
});
export type Plan = z.infer<typeof Plan>;

export const ProvenanceKind = z.enum(['corpus', 'context7', 'web', 'stackoverflow']);

export const Provenance = z.object({
  kind: ProvenanceKind,
  /** Section id for corpus material, URL for anything external. */
  ref: z.string(),
  /** Human-readable locator, e.g. "tech-interview-handbook › React › Hooks". */
  label: z.string().optional(),
});
export type Provenance = z.infer<typeof Provenance>;

export const ResearchNote = z.object({
  topicSlug: z.string(),
  /** Synthesized material — never a raw dump of retrieved sections. */
  content: z.string(),
  provenance: z.array(Provenance).min(1),
});
export type ResearchNote = z.infer<typeof ResearchNote>;

export const CardKind = z.enum(['concept', 'interview_question', 'coding_task']);
export type CardKind = z.infer<typeof CardKind>;

export const DraftCard = z.object({
  topicSlug: z.string(),
  kind: CardKind,
  front: z.string(),
  back: z.string(),
  /** Copied from the notes the card was written from. No source, no card. */
  provenance: z.array(Provenance).min(1),
});
export type DraftCard = z.infer<typeof DraftCard>;

export const RejectionReason = z.enum([
  'duplicate',
  'not_atomic',
  'no_source',
  'answer_leaks',
  'incorrect',
]);
export type RejectionReason = z.infer<typeof RejectionReason>;

export const CriticVerdict = z.object({
  // Plain z.number(), not .int() — see the note above PlanTopic.
  /** Indices into the DraftCard[] under review. */
  accepted: z.array(z.number()),
  rejected: z.array(
    z.object({
      index: z.number(),
      reason: RejectionReason,
      note: z.string(),
    }),
  ),
});
export type CriticVerdict = z.infer<typeof CriticVerdict>;

/**
 * Layer 1 collapses Planner + Researcher + Writer into one agent, so its output is a
 * plan plus the cards derived from it in a single validated payload.
 */
export const GenerationResult = z.object({
  topics: z.array(PlanTopic),
  cards: z.array(DraftCard),
});
export type GenerationResult = z.infer<typeof GenerationResult>;

/** Run phases, mirroring the runs.status column and the §6 state machine. */
export const RunStatus = z.enum([
  'pending',
  'extracting',
  'planning',
  'researching',
  'writing',
  'critiquing',
  'awaiting_approval',
  'done',
  'failed',
]);
export type RunStatus = z.infer<typeof RunStatus>;
