'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { DraftCard } from '@/agents/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

type RunState = {
  id: string;
  status: string;
  error: string | null;
  costUsd: number;
  topics: { slug: string; name: string }[];
  topicIdx: number | null;
  draftCards: DraftCard[];
};

const IN_FLIGHT = ['pending', 'extracting', 'planning', 'researching', 'writing', 'critiquing'];

const PHASE_LABEL: Record<string, string> = {
  pending: 'Queued',
  extracting: 'Reading the offer',
  planning: 'Planning topics',
  researching: 'Researching the corpus',
  writing: 'Writing cards',
  critiquing: 'Reviewing cards',
  awaiting_approval: 'Ready for your review',
  done: 'Done',
  failed: 'Failed',
};

/**
 * Pipeline progress, then the human gate.
 *
 * Polls while the run is in flight. Once it reaches awaiting_approval the drafts
 * become editable — the reviewer can fix wording before approving, so the approval
 * request sends full card bodies rather than a list of indices.
 */
export function RunClient({ initial }: { initial: RunState }) {
  const router = useRouter();
  const [run, setRun] = useState(initial);
  const [drafts, setDrafts] = useState<DraftCard[]>(initial.draftCards);
  const [discarded, setDiscarded] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inFlight = IN_FLIGHT.includes(run.status);

  useEffect(() => {
    if (!inFlight) return;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/runs/${run.id}`, { cache: 'no-store' });
        if (!response.ok) return;
        const next = (await response.json()) as RunState;
        setRun(next);
        if (next.status === 'awaiting_approval') setDrafts(next.draftCards);
      } catch {
        // Transient failures are fine — the next tick retries.
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [inFlight, run.id]);

  function edit(index: number, field: 'front' | 'back', value: string) {
    setDrafts((current) => current.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  }

  function toggleDiscard(index: number) {
    setDiscarded((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function approve() {
    setSubmitting(true);
    setError(null);
    try {
      const approved = drafts.filter((_, i) => !discarded.has(i));
      const response = await fetch(`/api/runs/${run.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved }),
      });
      const body = (await response.json()) as { approved?: number; error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      router.push('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'approval failed');
      setSubmitting(false);
    }
  }

  const keeping = drafts.length - discarded.size;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          {PHASE_LABEL[run.status] ?? run.status}
        </h1>
        <span className="text-sm text-muted-foreground">${run.costUsd.toFixed(4)}</span>
      </div>

      {inFlight && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            This runs one step at a time and survives restarts — you can close this page and come
            back.
          </p>
          {run.topics.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {run.topics.map((topic, i) => (
                <Badge
                  key={topic.slug}
                  variant={
                    run.topicIdx === null || i > run.topicIdx
                      ? 'outline'
                      : i < run.topicIdx
                        ? 'secondary'
                        : 'default'
                  }
                >
                  {topic.name}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}

      {run.status === 'failed' && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-sm text-destructive">{run.error}</p>
            <p className="text-xs text-muted-foreground">
              Progress up to this point was saved. Resuming continues from the last completed step.
            </p>
          </CardContent>
        </Card>
      )}

      {run.status === 'awaiting_approval' && (
        <>
          {drafts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No cards were produced. This usually means the corpus has no material for the planned
              topics — ingest more sources and try again.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {keeping} of {drafts.length} card{drafts.length === 1 ? '' : 's'} will be saved.
                  Edit freely before approving.
                </p>
                <Button onClick={approve} disabled={submitting || keeping === 0}>
                  {submitting ? 'Saving…' : `Approve ${keeping}`}
                </Button>
              </div>

              <div className="space-y-4">
                {drafts.map((card, index) => {
                  const dropped = discarded.has(index);
                  return (
                    <Card key={index} className={dropped ? 'opacity-50' : undefined}>
                      <CardHeader className="flex flex-row items-center justify-between gap-2">
                        <div className="flex gap-2">
                          <Badge variant="secondary">{card.topicSlug}</Badge>
                          <Badge variant="outline">{card.kind.replace('_', ' ')}</Badge>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => toggleDiscard(index)}>
                          {dropped ? 'Keep' : 'Discard'}
                        </Button>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Front</label>
                          <Textarea
                            value={card.front}
                            rows={2}
                            disabled={dropped}
                            onChange={(e) => edit(index, 'front', e.target.value)}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Back</label>
                          <Textarea
                            value={card.back}
                            rows={4}
                            disabled={dropped}
                            onChange={(e) => edit(index, 'back', e.target.value)}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Source: {card.provenance.map((p) => p.label ?? p.ref).join(' · ')}
                        </p>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {run.status === 'done' && (
        <p className="text-sm text-muted-foreground">
          Cards saved and scheduled. They are in today&apos;s review queue.
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
