'use client';

import { useCallback, useEffect, useState } from 'react';

import { Flashcard, Kbd, type FlashcardData } from '@/components/flashcard';
import { Button } from '@/components/ui/button';
import type { IntervalPreview } from '@/lib/intervals';

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
 * The daily loop, built to be driven without touching the mouse:
 * Space reveals, 1–4 rates, the next card appears. Interval previews sit on the
 * rating buttons so each choice says what it costs.
 */
export function ReviewsClient({ initial }: { initial: DueCard[] }) {
  const [queue, setQueue] = useState(initial);
  const [revealed, setRevealed] = useState(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const current = queue[0];

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
        setQueue((q) => q.slice(1));
        setRevealed(false);
        setDone((d) => d + 1);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'rating failed');
      } finally {
        setPending(false);
      }
    },
    [current, pending],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && /input|textarea/i.test(event.target.tagName)) return;
      if (!current) return;

      if (!revealed && (event.code === 'Space' || event.key === 'Enter')) {
        event.preventDefault();
        setRevealed(true);
        return;
      }
      if (revealed) {
        const rating = RATINGS.find((r) => r.key === event.key);
        if (rating) {
          event.preventDefault();
          void rate(rating.value);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, revealed, rate]);

  if (!current) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <p className="font-serif text-2xl">
          {done > 0 ? 'All done.' : 'Nothing due today.'}
        </p>
        <p className="text-sm text-muted-foreground">
          {done > 0
            ? `${done} card${done === 1 ? '' : 's'} reviewed — come back when the next ones fall due.`
            : 'Generate cards from an offer, approve them, and they will appear here.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between text-sm text-muted-foreground">
        <span>
          {done + 1} of {done + queue.length}
        </span>
        <span className="hidden gap-3 sm:flex">
          {revealed ? (
            <>
              <Kbd>1</Kbd>–<Kbd>4</Kbd> rate
            </>
          ) : (
            <>
              <Kbd>Space</Kbd> show answer
            </>
          )}
        </span>
      </div>

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

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
