'use client';

import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

export type DueCard = {
  cardId: string;
  front: string;
  back: string;
  kind: string;
  provenance: { kind: string; ref: string; label?: string }[] | null;
  topic: { slug: string; name: string } | null;
  reps: number | null;
};

const RATINGS = [
  { value: 1, label: 'Again', hint: 'forgot' },
  { value: 2, label: 'Hard', hint: 'struggled' },
  { value: 3, label: 'Good', hint: 'recalled' },
  { value: 4, label: 'Easy', hint: 'instant' },
] as const;

/**
 * The daily queue: show front, reveal back, rate.
 *
 * The answer stays hidden until explicitly revealed — self-testing before seeing the
 * answer is the entire mechanism of spaced repetition, so the UI must not shortcut it.
 */
export function ReviewsClient({ initial }: { initial: DueCard[] }) {
  const [queue, setQueue] = useState(initial);
  const [revealed, setRevealed] = useState(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const current = queue[0];

  async function rate(rating: number) {
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
  }

  if (!current) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Reviews</h1>
        <p className="text-muted-foreground">
          {done > 0
            ? `Done for now — ${done} card${done === 1 ? '' : 's'} reviewed.`
            : 'Nothing due. Approve some cards from an offer to start reviewing.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Reviews</h1>
        <span className="text-sm text-muted-foreground">
          {queue.length} due{done > 0 ? ` · ${done} done` : ''}
        </span>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          {current.topic && <Badge variant="secondary">{current.topic.name}</Badge>}
          <Badge variant="outline">{current.kind.replace('_', ' ')}</Badge>
          {current.reps === 0 && <Badge>new</Badge>}
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-lg leading-relaxed whitespace-pre-wrap">{current.front}</p>

          {revealed ? (
            <>
              <div className="border-t pt-4">
                <p className="leading-relaxed whitespace-pre-wrap">{current.back}</p>
              </div>

              {current.provenance && current.provenance.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Source: {current.provenance.map((p) => p.label ?? p.ref).join(' · ')}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                {RATINGS.map((r) => (
                  <Button
                    key={r.value}
                    variant={r.value === 3 ? 'default' : 'outline'}
                    disabled={pending}
                    onClick={() => rate(r.value)}
                  >
                    {r.label}
                    <span className="ml-1 text-xs opacity-60">{r.hint}</span>
                  </Button>
                ))}
              </div>
            </>
          ) : (
            <Button onClick={() => setRevealed(true)}>Show answer</Button>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
