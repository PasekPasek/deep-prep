import 'server-only';

import type { DraftCard, ExtractedOffer, PlanTopic, ResearchNote, RunStatus } from '@/agents/contracts';
import { dedupDrafts, rubricCheck, type DedupResult, type RubricResult } from '@/agents/critic';
import { extractOffer, extractOfferFromImage, fetchOfferText } from '@/agents/extractor';
import { planTopics } from '@/agents/generator';
import { researchTopic, type ResearchResult } from '@/agents/researcher';
import { reviseRejected, writeFromNote, type WriteResult } from '@/agents/writer';
import { db } from '@/lib/db';

import {
  appendDraftCards,
  getCurrentStep,
  getDraftCards,
  getNote,
  getPlan,
  loadRun,
  saveNote,
  saveRun,
  type CurrentStep,
  type RunRow,
} from './state';

/**
 * The pipeline state machine (CLAUDE.md §6).
 *
 * advanceRun executes EXACTLY ONE step per call and persists before returning, so a
 * serverless invocation never outlives its time limit and any crash costs at most one
 * step. The caller re-triggers until `done`.
 *
 * Layer 1 collapses planner/researcher/writer into one agent, so the phase sequence is
 * pending -> extracting -> planning -> researching (once per topic) -> awaiting_approval.
 * The `critiquing` phase arrives with the Critic in Layer 2; the status enum already
 * carries it.
 */

export const DEFAULT_BUDGET_USD = 1.5;

export function runBudgetUsd(): number {
  const raw = process.env.RUN_BUDGET_USD;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BUDGET_USD;
}

export class BudgetExceededError extends Error {
  constructor(spent: number, budget: number) {
    super(`budget_exceeded: run has spent $${spent.toFixed(4)} of $${budget.toFixed(2)}`);
    this.name = 'BudgetExceededError';
  }
}

/**
 * Hard ceiling on invocations per run — the circuit breaker for the self-trigger
 * chain. The budget guard stops LLM spend, but a state-machine bug that loops
 * WITHOUT spending would spin serverless invocations forever. Sized for the worst
 * legitimate run (every phase + a topic per step + repairs) with a wide margin:
 * a healthy run uses well under half of this.
 */
export const MAX_STEPS_PER_RUN = 60;

/**
 * Agent entry points, injectable so the state machine can be exercised without a
 * model provider. Production passes none of these and gets the real implementations.
 */
export type Deps = {
  fetchOfferText: (url: string) => Promise<string>;
  extractOffer: (
    text: string,
    meta: { runId: string },
  ) => Promise<{ value: ExtractedOffer; costUsd: number }>;
  extractOfferFromImage: (
    imageUrl: string,
    meta: { runId: string },
  ) => Promise<{ value: ExtractedOffer; costUsd: number }>;
  planTopics: (
    offer: ExtractedOffer,
    meta: { runId: string },
  ) => Promise<{ value: { topics: PlanTopic[] }; costUsd: number }>;
  researchTopic: (topic: PlanTopic, meta: { runId: string }) => Promise<ResearchResult>;
  writeFromNote: (
    topic: PlanTopic,
    note: ResearchNote,
    meta: { runId: string },
  ) => Promise<WriteResult>;
  reviseRejected: (
    topic: PlanTopic,
    note: ResearchNote,
    rejected: { front: string; back: string; reason: string; note: string }[],
    meta: { runId: string },
  ) => Promise<WriteResult>;
  rubricCheck: (drafts: DraftCard[], meta: { runId: string }) => Promise<RubricResult>;
  dedupDrafts: (drafts: DraftCard[], offerId: string) => Promise<DedupResult>;
};

export const defaultDeps: Deps = {
  fetchOfferText,
  extractOffer: (text, meta) => extractOffer(text, meta),
  extractOfferFromImage: (imageUrl, meta) => extractOfferFromImage(imageUrl, meta),
  planTopics: (offer, meta) => planTopics(offer, meta),
  researchTopic: (topic, meta) => researchTopic(topic, meta),
  writeFromNote: (topic, note, meta) => writeFromNote(topic, note, meta),
  reviseRejected: (topic, note, rejected, meta) => reviseRejected(topic, note, rejected, meta),
  rubricCheck: (drafts, meta) => rubricCheck(drafts, meta),
  dedupDrafts: (drafts, offerId) => dedupDrafts(drafts, offerId),
};

/** Researchers run in parallel within one invocation, in batches of this size. */
export const RESEARCH_BATCH = 3;
/** Critic → Writer revision loops before remaining rejects are surfaced to the human. */
export const MAX_REVISION_LOOPS = 2;

export type StepOutcome = {
  status: RunStatus;
  /** False once the run reaches a terminal or human-blocked state. */
  more: boolean;
  note?: string;
};

/**
 * Execute one step. Never throws for expected failures — a failed run is persisted
 * with status 'failed' and a readable error, because an exception escaping into a
 * serverless handler loses the reason.
 */
export async function advanceRun(runId: string, deps: Deps = defaultDeps): Promise<StepOutcome> {
  const run = await loadRun(runId);
  const step = getCurrentStep(run);
  const budget = runBudgetUsd();
  const spent = Number(run.cost_usd ?? 0);

  // Checked before spending, not after: the guard must stop the NEXT call, since the
  // one that crossed the line has already been paid for.
  if (spent >= budget && !isTerminal(run.status as RunStatus)) {
    await fail(runId, new BudgetExceededError(spent, budget));
    return { status: 'failed', more: false, note: 'budget_exceeded' };
  }

  // Circuit breaker: bound the self-trigger chain regardless of what the state
  // machine does. Counted here, in the one place every step passes through.
  if (!isTerminal(run.status as RunStatus)) {
    if ((run.steps ?? 0) >= MAX_STEPS_PER_RUN) {
      await fail(runId, new Error(`step_limit_exceeded: ${run.steps} invocations (max ${MAX_STEPS_PER_RUN})`), step);
      return { status: 'failed', more: false, note: 'step_limit_exceeded' };
    }
    await db()
      .from('runs')
      .update({ steps: (run.steps ?? 0) + 1 })
      .eq('id', runId);
  }

  try {
    switch (step.phase) {
      case 'pending':
      case 'extracting':
        return await stepExtract(run, deps);
      case 'planning':
        return await stepPlan(run, deps);
      case 'researching':
        return await stepResearch(run, deps, step.topicIdx ?? 0);
      case 'writing':
        return step.revision
          ? await stepRevise(run, deps, step)
          : await stepWrite(run, deps, step.topicIdx ?? 0);
      case 'critiquing':
        return await stepCritique(run, deps, step.loops ?? 0);
      case 'awaiting_approval':
        return { status: 'awaiting_approval', more: false, note: 'waiting for human review' };
      case 'done':
      case 'failed':
        return { status: step.phase, more: false };
      default:
        throw new Error(`Unhandled phase: ${step.phase}`);
    }
  } catch (error) {
    await fail(runId, error, step);
    return {
      status: 'failed',
      more: false,
      note: error instanceof Error ? error.message : String(error),
    };
  }
}

function isTerminal(status: RunStatus): boolean {
  return status === 'done' || status === 'failed' || status === 'awaiting_approval';
}

async function fail(runId: string, error: unknown, failedAt?: CurrentStep): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await saveRun(runId, {
    status: 'failed',
    error: message,
    // Preserving the failing step lets resume re-enter exactly there instead of
    // re-deriving the position from what happens to be persisted.
    currentStep: { phase: 'failed', ...(failedAt ? { failedAt } : {}) },
  });
}

// ---- steps ----

async function stepExtract(run: RunRow, deps: Deps): Promise<StepOutcome> {
  await saveRun(run.id, { status: 'extracting', currentStep: { phase: 'extracting' } });

  if (!run.offer_id) throw new Error('run has no offer_id');
  const { data: offer, error } = await db()
    .from('offers')
    .select('raw_input, input_kind')
    .eq('id', run.offer_id)
    .single();
  if (error) throw new Error(`loading offer failed: ${error.message}`);
  if (!offer.raw_input) throw new Error('offer has no raw_input');

  let extracted: { value: ExtractedOffer; costUsd: number };
  if (offer.input_kind === 'screenshot') {
    // raw_input is a Storage path in the private bucket. The signed URL is minted
    // fresh per attempt and short-lived — it only needs to survive one model call.
    const { data: signed, error: signError } = await db()
      .storage.from('screenshots')
      .createSignedUrl(offer.raw_input, 600);
    if (signError || !signed) {
      throw new Error(`could not sign screenshot URL: ${signError?.message ?? 'no data'}`);
    }
    extracted = await deps.extractOfferFromImage(signed.signedUrl, { runId: run.id });
  } else if (offer.input_kind === 'url') {
    const text = await deps.fetchOfferText(offer.raw_input);
    extracted = await deps.extractOffer(text, { runId: run.id });
  } else if (offer.input_kind === 'manual') {
    // A custom brief ("TypeScript, React, Kubernetes — senior") goes straight to the
    // Extractor: it normalises a bare tech list into requirements the same way it
    // digests a full offer.
    extracted = await deps.extractOffer(offer.raw_input, { runId: run.id });
  } else {
    throw new Error(`unknown input_kind "${offer.input_kind}"`);
  }

  await db()
    .from('offers')
    .update({
      extracted: extracted.value,
      company: extracted.value.company,
      role: extracted.value.role,
      seniority: extracted.value.seniority,
    })
    .eq('id', run.offer_id);

  await saveRun(run.id, {
    status: 'planning',
    currentStep: { phase: 'planning' },
    addCostUsd: extracted.costUsd,
  });

  return { status: 'planning', more: true, note: `extracted ${extracted.value.mustHave.length} requirements` };
}

async function stepPlan(run: RunRow, deps: Deps): Promise<StepOutcome> {
  if (!run.offer_id) throw new Error('run has no offer_id');
  const { data: offer, error } = await db()
    .from('offers')
    .select('extracted')
    .eq('id', run.offer_id)
    .single();
  if (error) throw new Error(`loading offer failed: ${error.message}`);
  if (!offer.extracted) throw new Error('offer has not been extracted yet');

  const plan = await deps.planTopics(offer.extracted as ExtractedOffer, { runId: run.id });

  if (plan.value.topics.length === 0) {
    // Not an error: an offer with no technical requirements legitimately yields no
    // topics. Park it for review rather than failing.
    await saveRun(run.id, {
      status: 'awaiting_approval',
      currentStep: { phase: 'awaiting_approval' },
      plan: plan.value,
      addCostUsd: plan.costUsd,
    });
    return { status: 'awaiting_approval', more: false, note: 'plan contained no topics' };
  }

  await saveRun(run.id, {
    status: 'researching',
    currentStep: { phase: 'researching', topicIdx: 0 },
    plan: plan.value,
    addCostUsd: plan.costUsd,
  });

  return { status: 'researching', more: true, note: `planned ${plan.value.topics.length} topics` };
}

/**
 * Research phase (Layer 4): a batch of Researchers runs in parallel inside one
 * invocation, each writing its own scratchpad row. Batching keeps a single
 * invocation inside serverless limits while still cutting wall time ~RESEARCH_BATCH×.
 */
async function stepResearch(run: RunRow, deps: Deps, topicIdx: number): Promise<StepOutcome> {
  const plan = getPlan(run);
  if (!plan) throw new Error('run reached researching without a plan');

  const batch = plan.topics.slice(topicIdx, topicIdx + RESEARCH_BATCH);
  if (batch.length === 0) {
    await saveRun(run.id, { status: 'writing', currentStep: { phase: 'writing', topicIdx: 0 } });
    return { status: 'writing', more: true, note: 'research done, writing cards' };
  }

  // allSettled, not all: when one researcher in the batch fails, the others' notes
  // are still saved BEFORE the step fails, so resume re-runs the batch against
  // idempotent saveNote instead of redoing finished work.
  const results = await Promise.allSettled(
    batch.map((topic) => deps.researchTopic(topic, { runId: run.id })),
  );

  let cost = 0;
  const parts: string[] = [];
  const errors: string[] = [];
  for (const [i, settled] of results.entries()) {
    if (settled.status === 'rejected') {
      errors.push(`${batch[i].slug}: ${settled.reason instanceof Error ? settled.reason.message : settled.reason}`);
      continue;
    }
    const result = settled.value;
    cost += result.costUsd;
    if (result.note) {
      await saveNote(run.id, result.note);
      parts.push(`${batch[i].slug}: noted (${result.sectionsFound}s/${result.externalFound}w)`);
    } else {
      parts.push(`${batch[i].slug}: no material`);
    }
  }

  if (errors.length > 0) {
    // Cost of the successful researchers is booked before failing, or the budget
    // guard would be blind to it.
    if (cost > 0) await saveRun(run.id, { addCostUsd: cost });
    throw new Error(`research failed for ${errors.length} topic(s): ${errors.join('; ')}`);
  }

  const nextIdx = topicIdx + batch.length;
  const done = nextIdx >= plan.topics.length;
  await saveRun(run.id, {
    status: done ? 'writing' : 'researching',
    currentStep: done
      ? { phase: 'writing', topicIdx: 0 }
      : { phase: 'researching', topicIdx: nextIdx },
    addCostUsd: cost,
  });

  return { status: done ? 'writing' : 'researching', more: true, note: parts.join(' · ') };
}

/** Writing phase: one topic per step, from that topic's scratchpad note only. */
async function stepWrite(run: RunRow, deps: Deps, topicIdx: number): Promise<StepOutcome> {
  const plan = getPlan(run);
  if (!plan) throw new Error('run reached writing without a plan');

  const topic = plan.topics[topicIdx];
  if (!topic) {
    await saveRun(run.id, { status: 'critiquing', currentStep: { phase: 'critiquing', loops: 0 } });
    return { status: 'critiquing', more: true, note: 'all topics written, critiquing' };
  }

  const note = await getNote(run.id, topic.slug);
  let outcomeNote: string;
  let cost = 0;

  if (!note) {
    outcomeNote = `${topic.slug}: no research note, skipped`;
  } else {
    const result = await deps.writeFromNote(topic, note, { runId: run.id });
    await appendDraftCards(run.id, result.cards);
    cost = result.costUsd;
    outcomeNote =
      `${topic.slug}: ${result.cards.length} cards from note` +
      (result.dropped.length > 0 ? ` (${result.dropped.length} dropped: unusable provenance)` : '');
  }

  const isLast = topicIdx + 1 >= plan.topics.length;
  await saveRun(run.id, {
    status: isLast ? 'critiquing' : 'writing',
    currentStep: isLast
      ? { phase: 'critiquing', loops: 0 }
      : { phase: 'writing', topicIdx: topicIdx + 1 },
    addCostUsd: cost,
  });

  return { status: isLast ? 'critiquing' : 'writing', more: true, note: outcomeNote };
}

/**
 * Critic phase (Layer 4): code dedup first, then the LLM rubric. Rejected
 * non-duplicates go back to the Writer for at most MAX_REVISION_LOOPS passes;
 * whatever is still rejected after the cap is surfaced to the reviewer as flags
 * rather than silently dropped — the human is the final arbiter.
 */
async function stepCritique(run: RunRow, deps: Deps, loops: number): Promise<StepOutcome> {
  if (!run.offer_id) throw new Error('run has no offer_id');

  const drafts = getDraftCards(run);
  const { kept, linked } = await deps.dedupDrafts(drafts, run.offer_id);
  const rubric = await deps.rubricCheck(kept, { runId: run.id });

  const dedupRecord = {
    linkedCount: linked.length,
    linked: linked.map((l) => ({
      front: l.front,
      existingCardId: l.existingCardId,
      existingFront: l.existingFront,
      similarity: l.similarity,
    })),
  };

  if (rubric.rejected.length > 0 && loops < MAX_REVISION_LOOPS) {
    // Send rejects back to the Writer. Accepted drafts stay; rejected leave the pile
    // and return (fixed or not at all) through the revision step.
    await saveRun(run.id, {
      status: 'writing',
      currentStep: {
        phase: 'writing',
        loops: loops + 1,
        dedup: dedupRecord,
        revision: {
          rejected: rubric.rejected.map((r) => ({
            topicSlug: r.card.topicSlug,
            front: r.card.front,
            back: r.card.back,
            reason: r.reason,
            note: r.note,
          })),
        },
      },
      draftCards: rubric.accepted,
      addCostUsd: rubric.costUsd,
    });
    return {
      status: 'writing',
      more: true,
      note: `critic rejected ${rubric.rejected.length} card(s) — revision loop ${loops + 1}`,
    };
  }

  // Loop cap reached (or nothing rejected): rejects become reviewer-facing flags and
  // stay in the pile — the human decides, with the critic's reasoning attached.
  const flagged = rubric.rejected.map((r) => ({
    front: r.card.front,
    reason: r.reason,
    note: r.note,
  }));

  await saveRun(run.id, {
    status: 'awaiting_approval',
    currentStep: {
      phase: 'awaiting_approval',
      dedup: dedupRecord,
      ...(flagged.length > 0 ? { criticFlags: flagged } : {}),
    },
    draftCards: [...rubric.accepted, ...rubric.rejected.map((r) => r.card)],
    addCostUsd: rubric.costUsd,
  });

  const parts = [`${rubric.accepted.length + rubric.rejected.length} drafts for review`];
  if (linked.length > 0) parts.push(`${linked.length} duplicate(s) linked`);
  if (flagged.length > 0) parts.push(`${flagged.length} flagged by critic after ${loops} loop(s)`);
  return { status: 'awaiting_approval', more: false, note: parts.join(', ') };
}

/** Revision step: re-write only what the Critic rejected, one invocation for all. */
async function stepRevise(run: RunRow, deps: Deps, step: CurrentStep): Promise<StepOutcome> {
  const plan = getPlan(run);
  if (!plan) throw new Error('run reached revision without a plan');
  const rejected = step.revision?.rejected ?? [];

  const byTopic = new Map<string, typeof rejected>();
  for (const r of rejected) {
    const list = byTopic.get(r.topicSlug) ?? [];
    list.push(r);
    byTopic.set(r.topicSlug, list);
  }

  let cost = 0;
  let revised = 0;
  for (const [slug, items] of byTopic) {
    const topic = plan.topics.find((t) => t.slug === slug);
    const note = await getNote(run.id, slug);
    if (!topic || !note) continue; // nothing to revise against — cards stay dropped

    const result = await deps.reviseRejected(
      topic,
      note,
      items.map(({ front, back, reason, note: criticNote }) => ({ front, back, reason, note: criticNote })),
      { runId: run.id },
    );
    await appendDraftCards(run.id, result.cards);
    cost += result.costUsd;
    revised += result.cards.length;
  }

  await saveRun(run.id, {
    status: 'critiquing',
    currentStep: { phase: 'critiquing', loops: step.loops ?? 1, dedup: step.dedup },
    addCostUsd: cost,
  });

  return {
    status: 'critiquing',
    more: true,
    note: `revised ${revised} of ${rejected.length} rejected card(s), re-critiquing`,
  };
}

/**
 * Restart a failed run from its last checkpoint — never from zero.
 *
 * The phase recorded in current_step is the one that failed, so clearing the error and
 * re-entering it re-runs only that step. Work already checkpointed (extraction, plan,
 * cards from earlier topics) is preserved.
 */
export async function resumeRun(runId: string, deps: Deps = defaultDeps): Promise<StepOutcome> {
  const run = await loadRun(runId);

  if (run.status !== 'failed') {
    return { status: run.status as RunStatus, more: !isTerminal(run.status as RunStatus) };
  }

  const step = getCurrentStep(run);

  // Preferred path: fail() recorded exactly where the run was. Re-enter there.
  if (step.failedAt) {
    await saveRun(runId, { status: step.failedAt.phase, currentStep: step.failedAt, error: null });
    return advanceRun(runId, deps);
  }

  // Fallback for runs failed before failedAt existed: derive from what is persisted.
  const plan = getPlan(run);
  const cards = getDraftCards(run);

  let phase: RunStatus = 'pending';
  let topicIdx = 0;
  if (plan && plan.topics.length > 0) {
    phase = 'researching';
    // Resume at the first topic with no cards yet. Topics that produced zero cards
    // legitimately (no corpus material) would otherwise be retried forever, so this
    // relies on the recorded index when available.
    const covered = new Set(cards.map((c) => c.topicSlug));
    const next = plan.topics.findIndex((t) => !covered.has(t.slug));
    topicIdx = next === -1 ? plan.topics.length : next;
  } else if (run.offer_id) {
    phase = 'planning';
  }

  await saveRun(runId, {
    status: phase,
    currentStep: phase === 'researching' ? { phase, topicIdx } : { phase },
    error: null,
  });

  return advanceRun(runId, deps);
}

/** Drive a run to completion in one process — used by CLI and tests, not by Vercel. */
export async function runToCompletion(
  runId: string,
  deps: Deps = defaultDeps,
  maxSteps = 50,
): Promise<StepOutcome> {
  let outcome: StepOutcome = { status: 'pending', more: true };
  for (let i = 0; i < maxSteps && outcome.more; i++) {
    outcome = await advanceRun(runId, deps);
    if (outcome.note) console.log(`  [${outcome.status}] ${outcome.note}`);
  }
  return outcome;
}
