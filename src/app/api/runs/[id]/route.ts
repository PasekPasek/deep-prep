import { getDraftCards, getPlan, loadRun } from '@/orchestrator/state';
import { json, serverError } from '@/lib/http';

/** GET /api/runs/[id] — run status for the progress view to poll. */

export const runtime = 'nodejs';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  // Next 16: params is async.
  const { id } = await context.params;

  try {
    const run = await loadRun(id);
    const plan = getPlan(run);
    const step = (run.current_step ?? {}) as { phase?: string; topicIdx?: number };

    return json({
      id: run.id,
      offerId: run.offer_id,
      status: run.status,
      error: run.error,
      costUsd: Number(run.cost_usd ?? 0),
      topics: plan?.topics.map((t) => ({ slug: t.slug, name: t.name })) ?? [],
      topicIdx: step.topicIdx ?? null,
      draftCards: getDraftCards(run),
      updatedAt: run.updated_at,
    });
  } catch (error) {
    return serverError(error instanceof Error ? error.message : 'unknown error');
  }
}
