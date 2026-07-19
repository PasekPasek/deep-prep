import 'server-only';

import type { DraftCard, Plan, RunStatus } from '@/agents/contracts';
import { db } from '@/lib/db';
import type { Database } from '@/lib/database.types';

/**
 * Run state persistence — the blackboard.
 *
 * Everything the pipeline needs to resume lives in the `runs` row. No step may hold
 * progress in memory across an await that could be the end of a serverless
 * invocation: if it is not written here, a crash loses it.
 */

export type RunRow = Database['public']['Tables']['runs']['Row'];

/** Where a run is inside its current phase. Written on every transition. */
export type CurrentStep = {
  phase: RunStatus;
  /** Index into plan.topics while researching/writing. */
  topicIdx?: number;
  /** Critic revision loops used so far (Layer 4). */
  loops?: number;
  /** On failure: the step that was executing, so resume re-enters exactly there. */
  failedAt?: CurrentStep;
  /** Set by the critiquing phase: drafts absorbed into existing cards. */
  dedup?: {
    linkedCount: number;
    linked: { front: string; existingCardId: string; existingFront: string; similarity: number }[];
  };
  /** Set when the Critic sends cards back to the Writer (revision pass, ≤2 loops). */
  revision?: {
    rejected: { topicSlug: string; front: string; back: string; reason: string; note: string }[];
  };
  /** Cards still rejected when the loop cap was reached — surfaced to the reviewer. */
  criticFlags?: { front: string; reason: string; note: string }[];
};

export async function createRun(offerId: string): Promise<RunRow> {
  const { data, error } = await db()
    .from('runs')
    .insert({ offer_id: offerId, status: 'pending', current_step: { phase: 'pending' } })
    .select()
    .single();
  if (error) throw new Error(`createRun failed: ${error.message}`);
  return data;
}

/** Thrown when a run id does not exist, so callers can answer 404 rather than 500. */
export class RunNotFoundError extends Error {
  constructor(readonly runId: string) {
    super(`run ${runId} not found`);
    this.name = 'RunNotFoundError';
  }
}

export async function loadRun(runId: string): Promise<RunRow> {
  const { data, error } = await db().from('runs').select().eq('id', runId).maybeSingle();
  if (error) throw new Error(`loadRun(${runId}) failed: ${error.message}`);
  if (!data) throw new RunNotFoundError(runId);
  return data;
}

export async function saveRun(
  runId: string,
  patch: {
    status?: RunStatus;
    currentStep?: CurrentStep;
    plan?: Plan;
    draftCards?: DraftCard[];
    error?: string | null;
    /** Added to the accumulated total, not overwritten. */
    addCostUsd?: number;
  },
): Promise<RunRow> {
  const update: Database['public']['Tables']['runs']['Update'] = {};

  if (patch.status !== undefined) update.status = patch.status;
  if (patch.currentStep !== undefined) update.current_step = patch.currentStep;
  if (patch.plan !== undefined) update.plan = patch.plan;
  if (patch.draftCards !== undefined) update.draft_cards = patch.draftCards;
  if (patch.error !== undefined) update.error = patch.error;

  if (patch.addCostUsd !== undefined && patch.addCostUsd > 0) {
    // Read-modify-write. Safe here because exactly one invocation owns a run at a
    // time — steps are sequential and self-triggered, never concurrent.
    const current = await loadRun(runId);
    update.cost_usd = Number(current.cost_usd ?? 0) + patch.addCostUsd;
  }

  const { data, error } = await db().from('runs').update(update).eq('id', runId).select().single();
  if (error) throw new Error(`saveRun(${runId}) failed: ${error.message}`);
  return data;
}

export function getCurrentStep(run: RunRow): CurrentStep {
  const step = run.current_step as CurrentStep | null;
  return step ?? { phase: (run.status as RunStatus) ?? 'pending' };
}

export function getPlan(run: RunRow): Plan | null {
  return (run.plan as Plan | null) ?? null;
}

export function getDraftCards(run: RunRow): DraftCard[] {
  return (run.draft_cards as DraftCard[] | null) ?? [];
}

/** Append draft cards without re-reading the whole run into the caller. */
export async function appendDraftCards(runId: string, cards: DraftCard[]): Promise<void> {
  if (cards.length === 0) return;
  const run = await loadRun(runId);
  await saveRun(runId, { draftCards: [...getDraftCards(run), ...cards] });
}

// ===== Scratchpad (blackboard, Layer 4) =====

import type { ResearchNote } from '@/agents/contracts';

/** Persist a researcher's note. Idempotent per (run, topic): re-research overwrites. */
export async function saveNote(runId: string, note: ResearchNote): Promise<void> {
  const supabase = db();
  // Delete-then-insert rather than upsert: scratchpad has no unique constraint on
  // (run_id, topic_slug), and a re-run of a topic must replace its note, not stack.
  await supabase.from('scratchpad').delete().eq('run_id', runId).eq('topic_slug', note.topicSlug);
  const { error } = await supabase.from('scratchpad').insert({
    run_id: runId,
    topic_slug: note.topicSlug,
    content: note.content,
    provenance: note.provenance,
  });
  if (error) throw new Error(`saving note failed: ${error.message}`);
}

export async function getNote(runId: string, topicSlug: string): Promise<ResearchNote | null> {
  const { data, error } = await db()
    .from('scratchpad')
    .select('topic_slug, content, provenance')
    .eq('run_id', runId)
    .eq('topic_slug', topicSlug)
    .maybeSingle();
  if (error) throw new Error(`loading note failed: ${error.message}`);
  if (!data) return null;
  return {
    topicSlug: data.topic_slug,
    content: data.content,
    provenance: data.provenance as ResearchNote['provenance'],
  };
}
