import { db } from '@/lib/db';

import { ReviewsClient, type DueCard } from './reviews-client';

/**
 * Home screen = today's review queue (CLAUDE.md §10: reviews are the daily loop).
 *
 * The queue is read server-side so the first paint already has cards; rating happens
 * client-side against /api/reviews.
 */

export const dynamic = 'force-dynamic';

export default async function ReviewsPage() {
  const { data, error } = await db()
    .from('review_state')
    .select('due, reps, cards!inner(id, front, back, kind, provenance, status, topics(slug, name))')
    .lte('due', new Date().toISOString())
    .eq('cards.status', 'active')
    .order('due', { ascending: true })
    .limit(50);

  if (error) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Reviews</h1>
        <p className="text-destructive">Could not load the queue: {error.message}</p>
      </div>
    );
  }

  const due: DueCard[] = (data ?? []).map((row) => {
    const card = row.cards as unknown as {
      id: string;
      front: string;
      back: string;
      kind: string;
      provenance: DueCard['provenance'];
      topics: { slug: string; name: string } | null;
    };
    return {
      cardId: card.id,
      front: card.front,
      back: card.back,
      kind: card.kind,
      provenance: card.provenance,
      topic: card.topics,
      reps: row.reps,
    };
  });

  return <ReviewsClient initial={due} />;
}
