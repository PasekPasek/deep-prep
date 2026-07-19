import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Flashcard, type FlashcardData } from '@/components/flashcard';
import { db } from '@/lib/db';
import { getDraftCards, getPlan, loadRun } from '@/orchestrator/state';

import { RunAgainButton } from './run-again-button';
import { RunClient } from './run-client';

export const dynamic = 'force-dynamic';

/** The [id] segment is the RUN id — a run is what there is progress to show. */
export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let run;
  try {
    run = await loadRun(id);
  } catch {
    notFound();
  }

  // A finished run shows the cards it produced — approving must not be a dead end.
  if (run.status === 'done' && run.offer_id) {
    return <DoneView offerId={run.offer_id} />;
  }

  const plan = getPlan(run);
  const step = (run.current_step ?? {}) as {
    topicIdx?: number;
    dedup?: { linkedCount: number; linked: { front: string; existingFront: string; similarity: number }[] };
    criticFlags?: { front: string; reason: string; note: string }[];
  };

  return (
    <RunClient
      initial={{
        id: run.id,
        status: run.status,
        error: run.error,
        costUsd: Number(run.cost_usd ?? 0),
        topics: plan?.topics.map((t) => ({ slug: t.slug, name: t.name })) ?? [],
        topicIdx: step.topicIdx ?? null,
        draftCards: getDraftCards(run),
        dedup: step.dedup ?? null,
        criticFlags: step.criticFlags ?? null,
      }}
    />
  );
}

async function DoneView({ offerId }: { offerId: string }) {
  const { data: offer } = await db()
    .from('offers')
    .select('company, role')
    .eq('id', offerId)
    .single();

  const { data: links } = await db()
    .from('card_offers')
    .select('cards!inner(id, front, back, kind, status, provenance, topics(name), review_state(state))')
    .eq('offer_id', offerId);

  const byTopic = new Map<string, FlashcardData[]>();
  let activeCount = 0;
  let readyCount = 0;
  for (const link of links ?? []) {
    const card = link.cards as unknown as {
      front: string;
      back: string;
      kind: string;
      status: string;
      provenance: FlashcardData['provenance'];
      topics: { name: string } | null;
      review_state: { state: number } | null;
    };
    if (card.status === 'active') {
      activeCount++;
      if ((card.review_state?.state ?? 0) >= 2) readyCount++;
    }
    const topic = card.topics?.name ?? 'Other';
    const list = byTopic.get(topic) ?? [];
    list.push({ front: card.front, back: card.back, kind: card.kind, provenance: card.provenance });
    byTopic.set(topic, list);
  }

  const total = [...byTopic.values()].reduce((n, list) => n + list.length, 0);
  const readyPct = activeCount > 0 ? Math.round((readyCount / activeCount) * 100) : null;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {offer?.role ?? 'Offer'}
          {offer?.company ? ` · ${offer.company}` : ''}
        </h1>
        <p className="text-sm text-muted-foreground">
          {total} card{total === 1 ? '' : 's'} in the pool from this offer
          {readyPct !== null && (
            <>
              {' · '}
              <span className="font-medium text-foreground">{readyPct}% ready</span>
              {` (${readyCount}/${activeCount} in Review or beyond)`}
            </>
          )}
          .{' '}
          <Link href="/" className="underline underline-offset-4">
            Review them →
          </Link>
        </p>
        <div className="pt-1">
          <RunAgainButton offerId={offerId} />
        </div>
      </header>

      {total === 0 && (
        <p className="text-sm text-muted-foreground">
          No cards were saved from this run — everything was discarded at review.
        </p>
      )}

      {[...byTopic.entries()].map(([topic, cards]) => (
        <section key={topic} className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            {topic} · {cards.length}
          </h2>
          {cards.map((card, i) => (
            <Flashcard key={i} card={card} />
          ))}
        </section>
      ))}
    </div>
  );
}
