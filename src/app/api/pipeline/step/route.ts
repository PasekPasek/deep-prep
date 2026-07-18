import { z } from 'zod';

import { badRequest, hasCronSecret, json, serverError, triggerNextStep, unauthorized } from '@/lib/http';
import { advanceRun } from '@/orchestrator/run';
import { RunNotFoundError } from '@/orchestrator/state';

/**
 * POST /api/pipeline/step — advance a run by exactly one step, then re-trigger.
 *
 * Internal only: called by the app itself, authenticated with CRON_SECRET rather than
 * a user session. This is the loop that keeps every invocation short enough for
 * serverless limits while making resume trivial.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

const Body = z.object({ runId: z.string().uuid() });

export async function POST(request: Request) {
  if (!hasCronSecret(request)) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('expected a JSON body');
  }

  const parsed = Body.safeParse(body);
  if (!parsed.success) return badRequest('body must be { runId: uuid }');

  try {
    const outcome = await advanceRun(parsed.data.runId);

    // Only chain forward while work remains. advanceRun has already persisted, so if
    // this trigger is lost the run simply waits for a manual resume.
    if (outcome.more) {
      triggerNextStep(parsed.data.runId, new URL(request.url).origin);
    }

    return json(outcome);
  } catch (error) {
    if (error instanceof RunNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    return serverError(error instanceof Error ? error.message : 'unknown error');
  }
}
