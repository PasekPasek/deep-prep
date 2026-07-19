import 'server-only';

import type { DraftCard, ExtractedOffer, PlanTopic, RunStatus } from '@/agents/contracts';
import { dedupDrafts, type DedupResult } from '@/agents/critic';
import { extractOffer, extractOfferFromImage, fetchOfferText } from '@/agents/extractor';
import { planTopics, writeCardsForTopic, type TopicResult } from '@/agents/generator';
import { db } from '@/lib/db';

import {
  appendDraftCards,
  getCurrentStep,
  getDraftCards,
  getPlan,
  loadRun,
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
  writeCardsForTopic: (topic: PlanTopic, meta: { runId: string }) => Promise<TopicResult>;
  dedupDrafts: (drafts: DraftCard[], offerId: string) => Promise<DedupResult>;
};

export const defaultDeps: Deps = {
  fetchOfferText,
  extractOffer: (text, meta) => extractOffer(text, meta),
  extractOfferFromImage: (imageUrl, meta) => extractOfferFromImage(imageUrl, meta),
  planTopics: (offer, meta) => planTopics(offer, meta),
  writeCardsForTopic: (topic, meta) => writeCardsForTopic(topic, meta),
  dedupDrafts: (drafts, offerId) => dedupDrafts(drafts, offerId),
};

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
      case 'writing':
        return await stepTopic(run, deps, step.topicIdx ?? 0);
      case 'critiquing':
        return await stepCritique(run, deps);
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

async function stepTopic(run: RunRow, deps: Deps, topicIdx: number): Promise<StepOutcome> {
  const plan = getPlan(run);
  if (!plan) throw new Error('run reached researching without a plan');

  const topic = plan.topics[topicIdx];
  if (!topic) {
    // All topics consumed (resume edge case) — go through the critic.
    await saveRun(run.id, { status: 'critiquing', currentStep: { phase: 'critiquing' } });
    return { status: 'critiquing', more: true, note: 'all topics done, deduplicating' };
  }

  const result = await deps.writeCardsForTopic(topic, { runId: run.id });
  await appendDraftCards(run.id, result.cards);

  const isLast = topicIdx + 1 >= plan.topics.length;
  await saveRun(run.id, {
    status: isLast ? 'critiquing' : 'researching',
    currentStep: isLast
      ? { phase: 'critiquing' }
      : { phase: 'researching', topicIdx: topicIdx + 1 },
    addCostUsd: result.costUsd,
  });

  const sourcesNote = [
    result.sectionsFound > 0 ? `${result.sectionsFound} sections` : null,
    result.externalFound > 0 ? `${result.externalFound} web sources` : null,
  ]
    .filter(Boolean)
    .join(' + ');
  const note =
    result.sectionsFound === 0 && result.externalFound === 0
      ? `${topic.slug}: no material found anywhere, 0 cards`
      : `${topic.slug}: ${result.cards.length} cards from ${sourcesNote}` +
        (result.dropped.length > 0 ? ` (${result.dropped.length} dropped: unusable provenance)` : '');

  return { status: isLast ? 'critiquing' : 'researching', more: true, note };
}

/**
 * Critic, Layer 2 shape: deterministic dedup. Drafts near-identical to saved cards
 * are absorbed — the existing card gets linked to this offer and the draft never
 * reaches the reviewer. What was absorbed is recorded on the run for the HITL view.
 */
async function stepCritique(run: RunRow, deps: Deps): Promise<StepOutcome> {
  if (!run.offer_id) throw new Error('run has no offer_id');

  const drafts = getDraftCards(run);
  const { kept, linked } = await deps.dedupDrafts(drafts, run.offer_id);

  await saveRun(run.id, {
    status: 'awaiting_approval',
    currentStep: {
      phase: 'awaiting_approval',
      dedup: {
        linkedCount: linked.length,
        linked: linked.map((l) => ({
          front: l.front,
          existingCardId: l.existingCardId,
          existingFront: l.existingFront,
          similarity: l.similarity,
        })),
      },
    },
    draftCards: kept,
  });

  const note =
    linked.length === 0
      ? `${kept.length} draft cards ready for review`
      : `${kept.length} drafts for review, ${linked.length} duplicate(s) linked to existing cards`;

  return { status: 'awaiting_approval', more: false, note };
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
