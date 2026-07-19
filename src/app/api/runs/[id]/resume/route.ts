import { json, serverError, triggerNextStep } from '@/lib/http';
import { resumeRun } from '@/orchestrator/run';
import { RunNotFoundError } from '@/orchestrator/state';

/**
 * POST /api/runs/[id]/resume — restart a failed run from its last checkpoint.
 *
 * Session-guarded (proxy.ts): resuming spends money, so it is a deliberate act of
 * the signed-in user, unlike the CRON_SECRET step route the pipeline calls itself.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  try {
    const outcome = await resumeRun(id);

    if (outcome.more) {
      triggerNextStep(id, new URL(request.url).origin);
    }

    return json(outcome);
  } catch (error) {
    if (error instanceof RunNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    return serverError(error instanceof Error ? error.message : 'unknown error');
  }
}
