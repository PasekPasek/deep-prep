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

export const PlanTopic = z.object({
  slug: z.string(),
  name: z.string(),
  /** Atomic concepts to cover — these drive how many cards the topic yields. */
  concepts: z.array(z.string()),
  prerequisites: z.array(z.string()),
  estimatedCards: z.number().int().min(1).max(15),
});
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
  /** Indices into the DraftCard[] under review. */
  accepted: z.array(z.number().int()),
  rejected: z.array(
    z.object({
      index: z.number().int(),
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
