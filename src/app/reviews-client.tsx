'use client';

import { useRouter } from 'next/navigation';
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
 * The daily loop, driven without the mouse:
 *   Space  reveal            1–4  rate
 *   →      skip (to the end of the queue — FSRS state untouched)
 *   ←      take back the last skip
 *
 * Skipping is queue reordering only. A skipped card stays due; it just stops
 * blocking the session.
 */
export function ReviewsClient({ initial }: { initial: DueCard[] }) {
  const router = useRouter();
  const [queue, setQueue] = useState(initial);
  const [skipped, setSkipped] = useState<DueCard[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const current = queue[0];
  const remaining = queue.length + skipped.length;

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
          const next = q.slice(1);
          // The last card was rated: skipped cards return for a second pass.
          if (next.length === 0) {
            setSkipped((s) => {
              if (s.length > 0) setTimeout(() => setQueue(s), 0);
              return [];
            });
          }
          return next;
        });
        setRevealed(false);
        setDone((d) => d + 1);
        // Refreshes the server-rendered due badge in the nav.
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'rating failed');
      } finally {
        setPending(false);
      }
    },
    [current, pending, router],
  );

  const skip = useCallback(() => {
    if (!current) return;
    setSkipped((s) => [...s, current]);
    setQueue((q) => q.slice(1));
    setRevealed(false);
  }, [current]);

  const unskip = useCallback(() => {
    setSkipped((s) => {
      if (s.length === 0) return s;
      const last = s[s.length - 1];
      setQueue((q) => [last, ...q]);
      setRevealed(false);
      return s.slice(0, -1);
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && /input|textarea/i.test(event.target.tagName)) return;

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        skip();
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        unskip();
        return;
      }
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
  }, [current, revealed, rate, skip, unskip]);

  if (!current && skipped.length > 0) {
    // Everything left was skipped — offer the second pass explicitly.
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <p className="font-serif text-2xl">
          {skipped.length} skipped card{skipped.length === 1 ? '' : 's'} left
        </p>
        <Button size="lg" onClick={() => { setQueue(skipped); setSkipped([]); }}>
          Review them now
        </Button>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <p className="font-serif text-2xl">{done > 0 ? 'All done.' : 'Nothing due here.'}</p>
        <p className="text-sm text-muted-foreground">
          {done > 0
            ? `${done} card${done === 1 ? '' : 's'} reviewed — come back when the next ones fall due.`
            : 'Nothing in this scope is due. Clear the filter or approve more cards.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between text-sm text-muted-foreground">
        <span>
          {done + 1} of {done + remaining}
          {skipped.length > 0 && ` · ${skipped.length} skipped`}
        </span>
        <span className="hidden items-center gap-3 sm:flex">
          {revealed ? (
            <>
              <Kbd>1</Kbd>–<Kbd>4</Kbd> rate
            </>
          ) : (
            <>
              <Kbd>Space</Kbd> answer
            </>
          )}
          <Kbd>→</Kbd> skip
          {skipped.length > 0 && (
            <>
              <Kbd>←</Kbd> back
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
        <div className="flex gap-2">
          <Button size="lg" className="flex-1 py-6" onClick={() => setRevealed(true)}>
            Show answer
          </Button>
          <Button size="lg" variant="outline" className="py-6" onClick={skip}>
            Skip →
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
