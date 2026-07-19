import { getDraftCards, getPlan, loadRun, RunNotFoundError } from '@/orchestrator/state';
import { json, serverError } from '@/lib/http';

/** GET /api/runs/[id] — run status for the progress view to poll. */

export const runtime = 'nodejs';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  // Next 16: params is async.
  const { id } = await context.params;

  try {
    const run = await loadRun(id);
    const plan = getPlan(run);
    const step = (run.current_step ?? {}) as {
      phase?: string;
      topicIdx?: number;
      dedup?: { linkedCount: number; linked: { front: string; existingFront: string; similarity: number }[] };
      criticFlags?: { front: string; reason: string; note: string }[];
    };

    return json({
      id: run.id,
      offerId: run.offer_id,
      status: run.status,
      error: run.error,
      costUsd: Number(run.cost_usd ?? 0),
      topics: plan?.topics.map((t) => ({ slug: t.slug, name: t.name })) ?? [],
      topicIdx: step.topicIdx ?? null,
      draftCards: getDraftCards(run),
      dedup: step.dedup ?? null,
      criticFlags: step.criticFlags ?? null,
      updatedAt: run.updated_at,
    });
  } catch (error) {
    if (error instanceof RunNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    return serverError(error instanceof Error ? error.message : 'unknown error');
  }
}
