import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Every card in the pool. Filtering and semantic search arrive in Layer 2. */
export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;

  let query = db()
    .from('cards')
    .select('id, front, back, kind, status, provenance, created_at, topics(slug, name), review_state(due, state, reps)')
    .order('created_at', { ascending: false })
    .limit(200);

  if (q?.trim()) {
    // Plain text match for now; pgvector search over cards.embedding lands in Layer 2.
    const term = `%${q.trim()}%`;
    query = query.or(`front.ilike.${term},back.ilike.${term}`);
  }

  const { data: cards, error } = await query;

  const STATE_LABEL = ['new', 'learning', 'review', 'relearning'];

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
        <span className="text-sm text-muted-foreground">
          {cards?.length ?? 0} card{cards?.length === 1 ? '' : 's'}
        </span>
      </div>

      <form className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search cards…"
          className="flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
        />
      </form>

      {error && <p className="text-destructive">Could not load cards: {error.message}</p>}

      {!error && (cards ?? []).length === 0 && (
        <p className="text-sm text-muted-foreground">
          {q ? `No cards match “${q}”.` : 'No cards yet. Submit an offer to generate some.'}
        </p>
      )}

      <div className="space-y-3">
        {(cards ?? []).map((card) => {
          const topic = card.topics as unknown as { slug: string; name: string } | null;
          const review = card.review_state as unknown as { state: number; reps: number } | null;
          const provenance = card.provenance as { kind: string; ref: string; label?: string }[] | null;

          return (
            <Card key={card.id}>
              <CardContent className="space-y-2 pt-6">
                <div className="flex flex-wrap items-center gap-2">
                  {topic && <Badge variant="secondary">{topic.name}</Badge>}
                  <Badge variant="outline">{card.kind.replace('_', ' ')}</Badge>
                  {review && <Badge variant="outline">{STATE_LABEL[review.state] ?? 'unknown'}</Badge>}
                  {card.status !== 'active' && <Badge variant="destructive">{card.status}</Badge>}
                </div>
                <p className="font-medium whitespace-pre-wrap">{card.front}</p>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{card.back}</p>
                {provenance && provenance.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Source: {provenance.map((p) => p.label ?? p.ref).join(' · ')}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
