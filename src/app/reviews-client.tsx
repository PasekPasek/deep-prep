'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Flashcard, Kbd, type FlashcardData } from '@/components/flashcard';
import { Button } from '@/components/ui/button';
import type { IntervalPreview } from '@/lib/intervals';
import { cn } from '@/lib/utils';

export type DueCard = FlashcardData & {
  cardId: string;
  reps: number | null;
  intervals: IntervalPreview;
};

const RATINGS = [
  { value: 1, key: '1', label: 'Again', interval: (c: DueCard) => c.intervals.again },
  { value: 2, key: '2', label: 'Hard', interval: (c: DueCard) => c.intervals.hard },
  { value: 3, key: '3', label: 'Good', interval: (c: DueCard) => c.intervals.good },
  { value: 4, key: '4', label: 'Easy', interval: (c: DueCard) => c.intervals.easy },
] as const;

/**
 * The daily loop.
 *
 *   ←/→    move between due cards (browsing — FSRS untouched)
 *   Space  reveal   ·   1–4  rate (removes the card from the session)
 *   L      toggle the list view of everything still due
 *
 * Rating is the only action that touches the schedule. Navigation is free movement
 * through the session, and the list view is the map of it: click any question to
 * jump straight to that card.
 */
export function ReviewsClient({ initial }: { initial: DueCard[] }) {
  const router = useRouter();
  const [queue, setQueue] = useState(initial);
  const [cursor, setCursor] = useState(0);
  const [listView, setListView] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const current = queue[cursor];

  const goto = useCallback(
    (index: number) => {
      setCursor(Math.max(0, Math.min(queue.length - 1, index)));
      setRevealed(false);
      setListView(false);
    },
    [queue.length],
  );

  const rate = useCallback(
    async (rating: number) => {
      if (!current || pending) return;
      setPending(true);
      setError(null);
      try {
        const response = await fetch('/api/reviews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cardId: current.cardId, rating }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${response.status}`);
        }
        setQueue((q) => {
          const next = q.filter((_, i) => i !== cursor);
          setCursor((c) => Math.min(c, Math.max(0, next.length - 1)));
          return next;
        });
        setRevealed(false);
        setDone((d) => d + 1);
        // Keeps the server-rendered due badge in the nav honest.
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'rating failed');
      } finally {
        setPending(false);
      }
    },
    [current, cursor, pending, router],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && /input|textarea|select/i.test(event.target.tagName)) return;
      if (queue.length === 0) return;

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        goto(cursor + 1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goto(cursor - 1);
      } else if (event.key === 'l' || event.key === 'L') {
        event.preventDefault();
        setListView((v) => !v);
      } else if (!listView && !revealed && (event.code === 'Space' || event.key === 'Enter')) {
        event.preventDefault();
        setRevealed(true);
      } else if (!listView && revealed) {
        const rating = RATINGS.find((r) => r.key === event.key);
        if (rating) {
          event.preventDefault();
          void rate(rating.value);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [queue.length, cursor, revealed, listView, rate, goto]);

  if (queue.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <p className="font-serif text-2xl">{done > 0 ? 'All done.' : 'Nothing due here.'}</p>
        <p className="text-sm text-muted-foreground">
          {done > 0
            ? `${done} card${done === 1 ? '' : 's'} reviewed — come back when the next ones fall due.`
            : 'Nothing in this scope is due. Clear the filters or approve more cards.'}
        </p>
      </div>
    );
  }

  const header = (
    <div className="flex items-baseline justify-between text-sm text-muted-foreground">
      <span>
        {cursor + 1} of {queue.length}
        {done > 0 && ` · ${done} rated`}
      </span>
      <div className="flex items-center gap-3">
        <span className="hidden items-center gap-3 sm:flex">
          <Kbd>←</Kbd>
          <Kbd>→</Kbd>
          {!listView && (revealed ? <><Kbd>1</Kbd>–<Kbd>4</Kbd> rate</> : <><Kbd>Space</Kbd> answer</>)}
        </span>
        <Button variant="ghost" size="sm" onClick={() => setListView((v) => !v)}>
          {listView ? 'Card view' : '≡ List'}
        </Button>
      </div>
    </div>
  );

  if (listView) {
    return (
      <div className="space-y-4">
        {header}
        <ol className="divide-y rounded-lg border">
          {queue.map((card, i) => (
            <li key={card.cardId}>
              <button
                type="button"
                onClick={() => goto(i)}
                className={cn(
                  'flex w-full items-baseline gap-3 px-4 py-2.5 text-left text-sm hover:bg-muted/50',
                  i === cursor && 'bg-muted/60',
                )}
              >
                <span className="w-6 shrink-0 text-right font-mono text-xs text-muted-foreground">
                  {i + 1}
                </span>
                <span className="truncate font-serif">{card.front}</span>
                {card.topic && (
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{card.topic}</span>
                )}
              </button>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {header}

      <Flashcard card={current} revealed={revealed} size="lg" />

      {revealed ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {RATINGS.map((r) => (
            <Button
              key={r.value}
              variant={r.value === 3 ? 'default' : 'outline'}
              size="lg"
              disabled={pending}
              onClick={() => rate(r.value)}
              className="flex-col gap-0 py-6"
            >
              <span>{r.label}</span>
              <span className="text-xs opacity-60">{r.interval(current)}</span>
            </Button>
          ))}
        </div>
      ) : (
        <Button size="lg" className="w-full py-6" onClick={() => setRevealed(true)}>
          Show answer
        </Button>
      )}

      <div className="flex justify-between">
        <Button variant="outline" size="sm" disabled={cursor === 0} onClick={() => goto(cursor - 1)}>
          ← Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={cursor >= queue.length - 1}
          onClick={() => goto(cursor + 1)}
        >
          Next →
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
