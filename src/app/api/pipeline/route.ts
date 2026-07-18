import { z } from 'zod';

import { db } from '@/lib/db';
import { badRequest, json, serverError, triggerNextStep } from '@/lib/http';
import { createRun } from '@/orchestrator/state';

/**
 * POST /api/pipeline — submit an offer and start a run.
 *
 * Returns as soon as the run row exists. The pipeline advances through self-triggered
 * step invocations, so this response is immediate and the UI polls
 * GET /api/runs/[id] for progress.
 */

export const runtime = 'nodejs';

const Body = z.object({
  url: z.string().url(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('expected a JSON body');
  }

  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return badRequest(`invalid body: ${parsed.error.issues.map((i) => i.message).join(', ')}`);
  }

  try {
    const { data: offer, error } = await db()
      .from('offers')
      .insert({ input_kind: 'url', raw_input: parsed.data.url })
      .select('id')
      .single();
    if (error) return serverError(`could not create offer: ${error.message}`);

    const run = await createRun(offer.id);

    triggerNextStep(run.id, new URL(request.url).origin);

    return json({ offerId: offer.id, runId: run.id, status: run.status }, 201);
  } catch (error) {
    return serverError(error instanceof Error ? error.message : 'unknown error');
  }
}
