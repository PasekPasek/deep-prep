import { z } from 'zod';

import { db } from '@/lib/db';
import { badRequest, json, serverError } from '@/lib/http';

/**
 * PATCH  /api/cards/[id] — suspend or reactivate (soft; keeps review history).
 * DELETE /api/cards/[id] — remove for good. FKs cascade, so card_offers,
 *                          review_state and review_log rows go with it.
 *
 * Both session-guarded by proxy.ts. Suspend is the default suggestion in the UI:
 * deletion also erases the card's review history, which the FSRS optimiser could
 * have learned from later.
 */

export const runtime = 'nodejs';

const Patch = z.object({ status: z.enum(['active', 'suspended']) });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('expected a JSON body');
  }
  const parsed = Patch.safeParse(body);
  if (!parsed.success) return badRequest('body must be { status: "active" | "suspended" }');

  const { data, error } = await db()
    .from('cards')
    .update({ status: parsed.data.status })
    .eq('id', id)
    .select('id, status')
    .maybeSingle();
  if (error) return serverError(error.message);
  if (!data) return Response.json({ error: `card ${id} not found` }, { status: 404 });

  return json(data);
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const { data, error } = await db().from('cards').delete().eq('id', id).select('id').maybeSingle();
  if (error) return serverError(error.message);
  if (!data) return Response.json({ error: `card ${id} not found` }, { status: 404 });

  return json({ deleted: id });
}
