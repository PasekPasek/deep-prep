import Link from 'next/link';

import { db } from '@/lib/db';
import type { ReviewStateRow } from '@/lib/fsrs';
import { intervalPreview } from '@/lib/intervals';
import { cn } from '@/lib/utils';

import { ReviewsClient, type DueCard } from './reviews-client';

/**
 * Home screen = today's review queue.
 *
 * The queue can be scoped by topic or by offer (?topic=slug / ?offer=id) — filter
 * chips are server-rendered links, so scoping survives reload and needs no client
 * state. Counts always describe the full due set, not the filtered one.
 */

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ topic?: string; offer?: string }>;

export default async function ReviewsPage({ searchParams }: { searchParams: SearchParams }) {
  const { topic: topicFilter, offer: offerFilter } = await searchParams;

  const { data, error } = await db()
    .from('review_state')
    .select(
      '*, cards!inner(id, front, back, kind, provenance, status, topics(slug, name), card_offers(offer_id))',
    )
    .lte('due', new Date().toISOString())
    .eq('cards.status', 'active')
    .order('due', { ascending: true })
    .limit(200);

  if (error) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Reviews</h1>
        <p className="text-destructive">Could not load the queue: {error.message}</p>
      </div>
    );
  }

  type JoinedCard = {
    id: string;
    front: string;
    back: string;
    kind: string;
    provenance: DueCard['provenance'];
    topics: { slug: string; name: string } | null;
    card_offers: { offer_id: string }[];
  };

  const now = new Date();
  const rows = (data ?? []).map((row) => {
    const card = row.cards as unknown as JoinedCard;
    const { cards: _cards, ...state } = row;
    void _cards;
    return { card, state: state as ReviewStateRow };
  });

  // Filter chips reflect the FULL due set; the queue reflects the active filter.
  const topicCounts = new Map<string, { name: string; count: number }>();
  const offerIds = new Set<string>();
  for (const { card } of rows) {
    if (card.topics) {
      const entry = topicCounts.get(card.topics.slug) ?? { name: card.topics.name, count: 0 };
      entry.count++;
      topicCounts.set(card.topics.slug, entry);
    }
    for (const link of card.card_offers) offerIds.add(link.offer_id);
  }

  const { data: offers } = offerIds.size
    ? await db().from('offers').select('id, company, role').in('id', [...offerIds])
    : { data: [] };

  const filtered = rows.filter(({ card }) => {
    if (topicFilter && card.topics?.slug !== topicFilter) return false;
    if (offerFilter && !card.card_offers.some((l) => l.offer_id === offerFilter)) return false;
    return true;
  });

  const due: DueCard[] = filtered.map(({ card, state }) => ({
    cardId: card.id,
    front: card.front,
    back: card.back,
    kind: card.kind,
    provenance: card.provenance,
    topic: card.topics?.name ?? null,
    reps: state.reps,
    intervals: intervalPreview(state, now),
  }));

  const showFilters = rows.length > 0 && (topicCounts.size > 1 || (offers?.length ?? 0) > 1);

  return (
    <div className="space-y-5">
      {showFilters && (
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <FilterChip href="/" active={!topicFilter && !offerFilter}>
            All · {rows.length}
          </FilterChip>
          {[...topicCounts.entries()].map(([slug, t]) => (
            <FilterChip key={slug} href={`/?topic=${slug}`} active={topicFilter === slug}>
              {t.name} · {t.count}
            </FilterChip>
          ))}
          {(offers ?? []).map((offer) => (
            <FilterChip key={offer.id} href={`/?offer=${offer.id}`} active={offerFilter === offer.id}>
              {offer.role ?? 'Offer'}
              {offer.company ? ` @ ${offer.company}` : ''}
            </FilterChip>
          ))}
        </div>
      )}

      <ReviewsClient key={`${topicFilter ?? ''}:${offerFilter ?? ''}`} initial={due} />
    </div>
  );
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'rounded-full border px-3 py-1 transition-colors',
        active
          ? 'border-foreground bg-foreground text-background'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </Link>
  );
}
