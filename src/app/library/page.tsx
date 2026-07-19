import { db } from '@/lib/db';
import type { FlashcardData } from '@/components/flashcard';

import { LibraryClient, type LibraryCard } from './library-client';

export const dynamic = 'force-dynamic';

const STATE_LABEL = ['new', 'learning', 'review', 'relearning'];
const PAGE_SIZE = 200;

/** The whole card pool, grouped by topic, answers hidden until asked for. */
export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;

  let query = db()
    .from('cards')
    .select('id, front, back, kind, status, provenance, created_at, topics(name), review_state(state)', {
      count: 'exact',
    })
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);

  if (q?.trim()) {
    const term = `%${q.trim()}%`;
    query = query.or(`front.ilike.${term},back.ilike.${term}`);
  }

  const { data: cards, error, count } = await query;

  const byTopic = new Map<string, LibraryCard[]>();
  for (const card of cards ?? []) {
    const topic = (card.topics as unknown as { name: string } | null)?.name ?? 'Other';
    const review = card.review_state as unknown as { state: number } | null;
    const list = byTopic.get(topic) ?? [];
    list.push({
      id: card.id,
      front: card.front,
      back: card.back,
      kind: card.kind,
      provenance: card.provenance as FlashcardData['provenance'],
      state: review ? (STATE_LABEL[review.state] ?? null) : null,
      suspended: card.status !== 'active',
    });
    byTopic.set(topic, list);
  }

  const shown = cards?.length ?? 0;
  const total = count ?? shown;

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
        <span className="text-sm text-muted-foreground">
          {shown < total ? `showing ${shown} of ${total} cards` : `${total} card${total === 1 ? '' : 's'}`}
        </span>
      </header>

      <form>
        <input
          type="search"
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search cards…"
          className="h-10 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </form>

      {error && <p className="text-destructive">Could not load cards: {error.message}</p>}

      {!error && shown === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {q ? `No cards match “${q}”.` : 'No cards yet — submit an offer to generate some.'}
        </p>
      )}

      {shown > 0 && <LibraryClient groups={[...byTopic.entries()]} />}
    </div>
  );
}
