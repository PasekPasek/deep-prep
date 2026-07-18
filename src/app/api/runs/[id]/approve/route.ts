import { z } from 'zod';

import { DraftCard } from '@/agents/contracts';
import { db } from '@/lib/db';
import { embed, toVectorLiteral } from '@/lib/embeddings';
import { initialReviewState } from '@/lib/fsrs';
import { badRequest, json, serverError } from '@/lib/http';
import { getDraftCards, loadRun, saveRun } from '@/orchestrator/state';

/**
 * POST /api/runs/[id]/approve — the human gate.
 *
 * Nothing reaches the card pool without passing through here. Approved cards are
 * inserted with an embedding (for dedup and library search), linked to the offer, and
 * initialised in FSRS so they appear in today's queue.
 *
 * The body carries the cards rather than a list of indices, because the reviewer may
 * have edited front/back text before approving.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

const Body = z.object({
  approved: z.array(DraftCard),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('expected a JSON body');
  }

  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return badRequest(`invalid body: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  }

  try {
    const run = await loadRun(id);
    if (!run.offer_id) return badRequest('run has no offer');
    if (run.status !== 'awaiting_approval') {
      return badRequest(`run is ${run.status}, not awaiting_approval`);
    }

    const supabase = db();
    const approved = parsed.data.approved;
    const created: string[] = [];

    for (const card of approved) {
      const topicId = await ensureTopic(card.topicSlug);

      // Embedding is computed at save, over the same text the Critic will compare
      // against for dedup in Layer 2.
      const vector = await embed(`${card.front}\n\n${card.back}`);

      const { data: inserted, error } = await supabase
        .from('cards')
        .insert({
          topic_id: topicId,
          kind: card.kind,
          front: card.front,
          back: card.back,
          provenance: card.provenance,
          embedding: toVectorLiteral(vector),
          status: 'active',
        })
        .select('id')
        .single();
      if (error) return serverError(`inserting card failed: ${error.message}`);

      const { error: linkError } = await supabase
        .from('card_offers')
        .insert({ card_id: inserted.id, offer_id: run.offer_id });
      if (linkError) return serverError(`linking card to offer failed: ${linkError.message}`);

      const { error: fsrsError } = await supabase
        .from('review_state')
        .insert(initialReviewState(inserted.id));
      if (fsrsError) return serverError(`initialising review state failed: ${fsrsError.message}`);

      created.push(inserted.id);
    }

    const discarded = getDraftCards(run).length - approved.length;
    await saveRun(id, {
      status: 'done',
      currentStep: { phase: 'done' },
      // Drafts are cleared once resolved; the cards table is now the record.
      draftCards: [],
    });

    return json({ approved: created.length, discarded, cardIds: created });
  } catch (error) {
    return serverError(error instanceof Error ? error.message : 'unknown error');
  }
}

/** Topics are shared across offers, so look up by slug before creating. */
async function ensureTopic(slug: string): Promise<string> {
  const supabase = db();

  const { data: existing } = await supabase.from('topics').select('id').eq('slug', slug).maybeSingle();
  if (existing) return existing.id;

  const name = slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  const { data, error } = await supabase
    .from('topics')
    .upsert({ slug, name }, { onConflict: 'slug' })
    .select('id')
    .single();
  if (error) throw new Error(`ensureTopic(${slug}) failed: ${error.message}`);
  return data.id;
}
