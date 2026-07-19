import { Flashcard, type FlashcardData } from '@/components/flashcard';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const STATE_LABEL = ['new', 'learning', 'review', 'relearning'];

/** Every card in the pool, grouped by topic. Semantic search arrives in Layer 2. */
export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;

  let query = db()
    .from('cards')
    .select('id, front, back, kind, status, provenance, created_at, topics(name), review_state(state, reps)')
    .order('created_at', { ascending: false })
    .limit(200);

  if (q?.trim()) {
    const term = `%${q.trim()}%`;
    query = query.or(`front.ilike.${term},back.ilike.${term}`);
  }

  const { data: cards, error } = await query;

  type Row = FlashcardData & { id: string; state: string | null; suspended: boolean };
  const byTopic = new Map<string, Row[]>();
  for (const card of cards ?? []) {
    const topic = (card.topics as unknown as { name: string } | null)?.name ?? 'Other';
    const review = (card.review_state as unknown as { state: number } | null);
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

  const total = cards?.length ?? 0;

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
        <span className="text-sm text-muted-foreground">
          {total} card{total === 1 ? '' : 's'}
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

      {!error && total === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {q ? `No cards match “${q}”.` : 'No cards yet — submit an offer to generate some.'}
        </p>
      )}

      {[...byTopic.entries()].map(([topic, rows]) => (
        <section key={topic} className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            {topic} · {rows.length}
          </h2>
          {rows.map((row) => (
            <Flashcard
              key={row.id}
              card={row}
              className={row.suspended ? 'opacity-50' : undefined}
              footer={
                row.state ? (
                  <p className="text-xs text-muted-foreground">
                    {row.suspended ? 'suspended · ' : ''}
                    {row.state}
                  </p>
                ) : undefined
              }
            />
          ))}
        </section>
      ))}
    </div>
  );
}
