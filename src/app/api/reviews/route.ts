import { z } from 'zod';

import { db } from '@/lib/db';
import { applyRating, isGrade, type ReviewStateRow } from '@/lib/fsrs';
import { badRequest, json, serverError } from '@/lib/http';

/**
 * GET  /api/reviews — cards due now, soonest first.
 * POST /api/reviews — submit a rating; ts-fsrs schedules the next occurrence.
 */

export const runtime = 'nodejs';

export async function GET() {
  try {
    const { data, error } = await db()
      .from('review_state')
      .select('*, cards!inner(id, front, back, kind, provenance, status, topics(slug, name))')
      .lte('due', new Date().toISOString())
      .eq('cards.status', 'active')
      .order('due', { ascending: true })
      .limit(50);
    if (error) return serverError(`loading queue failed: ${error.message}`);

    return json({
      due: (data ?? []).map((row) => {
        const card = row.cards as unknown as {
          id: string;
          front: string;
          back: string;
          kind: string;
          provenance: unknown;
          topics: { slug: string; name: string } | null;
        };
        return {
          cardId: card.id,
          front: card.front,
          back: card.back,
          kind: card.kind,
          provenance: card.provenance,
          topic: card.topics,
          due: row.due,
          reps: row.reps,
        };
      }),
    });
  } catch (error) {
    return serverError(error instanceof Error ? error.message : 'unknown error');
  }
}

const RatingBody = z.object({
  cardId: z.string().uuid(),
  rating: z.number().int().min(1).max(4),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('expected a JSON body');
  }

  const parsed = RatingBody.safeParse(body);
  if (!parsed.success) return badRequest('body must be { cardId: uuid, rating: 1..4 }');
  if (!isGrade(parsed.data.rating)) return badRequest('rating must be 1 (Again) to 4 (Easy)');

  try {
    const supabase = db();

    const { data: row, error } = await supabase
      .from('review_state')
      .select('*')
      .eq('card_id', parsed.data.cardId)
      .single();
    if (error) return badRequest(`no review state for card ${parsed.data.cardId}`);

    const { state, log } = applyRating(row as ReviewStateRow, parsed.data.rating);

    // State and log are written together: a rating that updated the schedule without
    // being logged would corrupt any later FSRS optimisation over the history.
    const { error: stateError } = await supabase.from('review_state').upsert(state);
    if (stateError) return serverError(`updating schedule failed: ${stateError.message}`);

    const { error: logError } = await supabase.from('review_log').insert(log);
    if (logError) return serverError(`writing review log failed: ${logError.message}`);

    return json({ cardId: state.card_id, due: state.due, state: state.state, reps: state.reps });
  } catch (error) {
    return serverError(error instanceof Error ? error.message : 'unknown error');
  }
}
