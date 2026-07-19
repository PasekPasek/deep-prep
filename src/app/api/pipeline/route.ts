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

/**
 * A fresh offer by URL, a custom text brief ("TypeScript, React, Kubernetes —
 * senior"), or a re-run of an existing offer.
 */
const Body = z.union([
  z.object({ url: z.string().url() }),
  z.object({ text: z.string().min(10).max(40_000) }),
  z.object({ offerId: z.string().uuid() }),
]);

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('expected a JSON body');
  }

  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return badRequest('body must be { url } or { offerId }');
  }

  try {
    let offerId: string;

    if ('offerId' in parsed.data) {
      // Re-run: the offer must exist, and only one run may be in flight for it —
      // two concurrent runs would double-spend on identical topics and then race
      // each other's dedup.
      const { data: offer } = await db()
        .from('offers')
        .select('id')
        .eq('id', parsed.data.offerId)
        .maybeSingle();
      if (!offer) return badRequest(`offer ${parsed.data.offerId} not found`);

      const { data: active } = await db()
        .from('runs')
        .select('id, status')
        .eq('offer_id', offer.id)
        .not('status', 'in', '("done","failed")')
        .limit(1);
      if (active && active.length > 0) {
        return badRequest(`a run for this offer is already ${active[0].status}`);
      }
      offerId = offer.id;
    } else {
      const isUrl = 'url' in parsed.data;
      const { data: offer, error } = await db()
        .from('offers')
        .insert(
          isUrl
            ? { input_kind: 'url', raw_input: (parsed.data as { url: string }).url }
            : { input_kind: 'manual', raw_input: (parsed.data as { text: string }).text },
        )
        .select('id')
        .single();
      if (error) return serverError(`could not create offer: ${error.message}`);
      offerId = offer.id;
    }

    const run = await createRun(offerId);

    triggerNextStep(run.id, new URL(request.url).origin);

    return json({ offerId, runId: run.id, status: run.status }, 201);
  } catch (error) {
    return serverError(error instanceof Error ? error.message : 'unknown error');
  }
}
