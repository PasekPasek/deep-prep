import { SelectFilter } from '@/components/select-filter';
import { db } from '@/lib/db';
import { embed, toVectorLiteral } from '@/lib/embeddings';
import type { FlashcardData } from '@/components/flashcard';

import { LibraryClient, type LibraryCard } from './library-client';

export const dynamic = 'force-dynamic';

const STATE_LABEL = ['new', 'learning', 'review', 'relearning'];
const KIND_LABEL: Record<string, string> = {
  concept: 'Concept',
  interview_question: 'Interview question',
  coding_task: 'Coding task',
};
const PAGE_SIZE = 200;

/** The whole card pool, grouped by topic, answers hidden until asked for. */
export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; topic?: string; kind?: string; state?: string }>;
}) {
  const { q, topic: topicFilter, kind: kindFilter, state: stateFilter } = await searchParams;

  let query = db()
    .from('cards')
    .select('id, front, back, kind, status, provenance, created_at, topics(name), review_state(state)', {
      count: 'exact',
    })
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);

  // Search is semantic: the query is embedded and matched against card embeddings —
  // "closures" finds the useEffect-cleanup card even with zero shared words. Ordered
  // ids come from match_cards; full rows are fetched separately. Falls back to
  // substring match if the embedding call fails, so search never breaks outright.
  let semanticOrder: Map<string, number> | null = null;
  if (q?.trim()) {
    try {
      const embedding = await embed(q.trim());
      const { data: matches, error: rpcError } = await db().rpc('match_cards', {
        query_embedding: toVectorLiteral(embedding),
        match_count: 50,
      });
      if (rpcError) throw new Error(rpcError.message);
      semanticOrder = new Map((matches ?? []).map((m, i) => [m.card_id, i]));
      query = query.in('id', [...semanticOrder.keys()]);
    } catch (e) {
      console.warn('[library] semantic search failed, falling back to substring:', e);
      const term = `%${q.trim()}%`;
      query = query.or(`front.ilike.${term},back.ilike.${term}`);
    }
  }

  const { data: cards, error, count } = await query;

  // Dropdown filters run over the fetched page in JS — at PAGE_SIZE rows that is
  // cheaper than three joins, and counts stay consistent with what is on screen.
  const all = (cards ?? []).map((card) => {
    const review = card.review_state as unknown as { state: number } | null;
    return {
      id: card.id,
      front: card.front,
      back: card.back,
      kind: card.kind,
      provenance: card.provenance as FlashcardData['provenance'],
      topic: (card.topics as unknown as { name: string } | null)?.name ?? 'Other',
      state: review ? (STATE_LABEL[review.state] ?? null) : null,
      suspended: card.status !== 'active',
    };
  });

  const countBy = <K extends string>(pick: (c: (typeof all)[number]) => K | null) => {
    const m = new Map<K, number>();
    for (const c of all) {
      const k = pick(c);
      if (k !== null) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const topicCounts = countBy((c) => c.topic);
  const kindCounts = countBy((c) => c.kind);
  const stateCounts = countBy((c) => (c.suspended ? 'suspended' : c.state));

  const filtered = all.filter(
    (c) =>
      (!topicFilter || c.topic === topicFilter) &&
      (!kindFilter || c.kind === kindFilter) &&
      (!stateFilter ||
        (stateFilter === 'suspended' ? c.suspended : !c.suspended && c.state === stateFilter)),
  );

  // Search results keep their relevance order in one flat group; browsing without a
  // query groups by topic. Interleaving the two would destroy whichever order the
  // user actually asked for.
  const groups: [string, LibraryCard[]][] = [];
  if (semanticOrder) {
    const ranked = [...filtered].sort(
      (a, b) => (semanticOrder.get(a.id) ?? 999) - (semanticOrder.get(b.id) ?? 999),
    );
    if (ranked.length > 0) groups.push([`Results for “${q!.trim()}” · by relevance`, ranked]);
  } else {
    const byTopic = new Map<string, LibraryCard[]>();
    for (const card of filtered) {
      const list = byTopic.get(card.topic) ?? [];
      list.push(card);
      byTopic.set(card.topic, list);
    }
    groups.push(...byTopic.entries());
  }

  const shown = filtered.length;
  const total = count ?? all.length;

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
        <span className="text-sm text-muted-foreground">
          {shown < total ? `showing ${shown} of ${total} cards` : `${total} card${total === 1 ? '' : 's'}`}
        </span>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <form className="min-w-48 flex-1">
          <input
            type="search"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Search cards…"
            className="h-9 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </form>
        <SelectFilter
          param="topic"
          allLabel="All topics"
          options={[...topicCounts.entries()].map(([t, n]) => ({ value: t, label: t, count: n }))}
        />
        <SelectFilter
          param="kind"
          allLabel="All kinds"
          options={[...kindCounts.entries()].map(([k, n]) => ({
            value: k,
            label: KIND_LABEL[k] ?? k,
            count: n,
          }))}
        />
        <SelectFilter
          param="state"
          allLabel="Any state"
          options={[...stateCounts.entries()]
            .filter(([s]) => s !== null)
            .map(([s, n]) => ({ value: s as string, label: s as string, count: n }))}
        />
      </div>

      {error && <p className="text-destructive">Could not load cards: {error.message}</p>}

      {!error && shown === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {q || topicFilter || kindFilter || stateFilter
            ? 'No cards match these filters.'
            : 'No cards yet — submit an offer to generate some.'}
        </p>
      )}

      {shown > 0 && <LibraryClient groups={groups} />}
    </div>
  );
}
