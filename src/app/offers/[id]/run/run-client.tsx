'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import type { DraftCard } from '@/agents/contracts';
import { Flashcard, Kbd } from '@/components/flashcard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  failed: 'Failed',
};

type Decision = 'keep' | 'discard';

/**
 * Pipeline progress, then card triage.
 *
 * Triage is one card at a time — the same focus as the review flow, because deciding
 * on 56 cards in a wall of forms is exactly what made the first version unusable.
 * Keyboard: K keep · D discard · E edit · Backspace go back. Decisions are local
 * until the final save, so nothing is committed by accident.
 */
export function RunClient({ initial }: { initial: RunState }) {
  const router = useRouter();
  const [run, setRun] = useState(initial);
  const [drafts, setDrafts] = useState<DraftCard[]>(initial.draftCards);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inFlight = IN_FLIGHT.includes(run.status);
  const triaging = run.status === 'awaiting_approval' && cursor < drafts.length;
  const summarising = run.status === 'awaiting_approval' && drafts.length > 0 && cursor >= drafts.length;
  const current = triaging ? drafts[cursor] : undefined;
  const kept = decisions.filter((d) => d === 'keep').length;

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
        // Transient poll failures are fine — the next tick retries.
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [inFlight, run.id]);

  const decide = useCallback(
    (decision: Decision) => {
      setDecisions((d) => {
        const next = [...d];
        next[cursor] = decision;
        return next;
      });
      setEditing(false);
      setCursor((c) => c + 1);
    },
    [cursor],
  );

  const goBack = useCallback(() => {
    setEditing(false);
    setCursor((c) => Math.max(0, c - 1));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (editing) return;
      if (event.target instanceof HTMLElement && /input|textarea/i.test(event.target.tagName)) return;
      if (!triaging) return;

      if (event.key === 'k' || event.key === 'ArrowRight') decide('keep');
      else if (event.key === 'd') decide('discard');
      else if (event.key === 'e') setEditing(true);
      else if (event.key === 'Backspace' || event.key === 'ArrowLeft') goBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [triaging, editing, decide, goBack]);

  function edit(field: 'front' | 'back', value: string) {
    setDrafts((all) => all.map((c, i) => (i === cursor ? { ...c, [field]: value } : c)));
  }

  async function save() {
    setSubmitting(true);
    setError(null);
    try {
      const approved = drafts.filter((_, i) => decisions[i] === 'keep');
      const response = await fetch(`/api/runs/${run.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved }),
      });
      const body = (await response.json()) as { approved?: number; error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      router.push('/');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'saving failed');
      setSubmitting(false);
    }
  }

  // ---- in flight ----
  if (inFlight) {
    return (
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{PHASE_LABEL[run.status]}…</h1>
          <p className="text-sm text-muted-foreground">
            Runs one step at a time and survives restarts — safe to close this page.
            Cost so far: ${run.costUsd.toFixed(2)}
          </p>
        </header>
        {run.topics.length > 0 && (
          <ol className="space-y-1.5">
            {run.topics.map((topic, i) => {
              const state =
                run.topicIdx === null || i > run.topicIdx ? 'waiting' : i < run.topicIdx ? 'done' : 'active';
              return (
                <li key={topic.slug} className="flex items-center gap-2 text-sm">
                  <span
                    className={
                      state === 'done'
                        ? 'text-green-700 dark:text-green-500'
                        : state === 'active'
                          ? 'animate-pulse'
                          : 'text-muted-foreground/50'
                    }
                  >
                    {state === 'done' ? '✓' : state === 'active' ? '●' : '○'}
                  </span>
                  <span className={state === 'waiting' ? 'text-muted-foreground/60' : ''}>{topic.name}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    );
  }

  // ---- failed ----
  if (run.status === 'failed') {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Run failed</h1>
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">{run.error}</p>
        <p className="text-sm text-muted-foreground">
          Progress up to this point was saved; resuming continues from the last completed step.
        </p>
      </div>
    );
  }

  // ---- empty result ----
  if (run.status === 'awaiting_approval' && drafts.length === 0) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">No cards produced</h1>
        <p className="text-sm text-muted-foreground">
          The corpus has no material for the planned topics. Ingest more sources and run the offer again.
        </p>
      </div>
    );
  }

  // ---- triage ----
  if (triaging && current) {
    return (
      <div className="space-y-5">
        <div className="flex items-baseline justify-between text-sm text-muted-foreground">
          <span>
            {cursor + 1} of {drafts.length} · {kept} kept
          </span>
          <span className="hidden gap-3 sm:flex">
            <Kbd>K</Kbd> keep <Kbd>D</Kbd> discard <Kbd>E</Kbd> edit <Kbd>⌫</Kbd> back
          </span>
        </div>

        {editing ? (
          <div className="space-y-3 rounded-lg border border-t-[3px] border-t-red-800/60 bg-card p-5">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Question</label>
              <Textarea value={current.front} rows={3} onChange={(e) => edit('front', e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Answer</label>
              <Textarea value={current.back} rows={7} onChange={(e) => edit('back', e.target.value)} />
            </div>
            <Button onClick={() => setEditing(false)}>Done editing</Button>
          </div>
        ) : (
          <Flashcard
            card={{ ...current, topic: current.topicSlug }}
            size="lg"
          />
        )}

        {!editing && (
          <div className="flex gap-2">
            <Button size="lg" className="flex-1" onClick={() => decide('keep')}>
              Keep
            </Button>
            <Button size="lg" variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button size="lg" variant="outline" className="text-destructive" onClick={() => decide('discard')}>
              Discard
            </Button>
          </div>
        )}
      </div>
    );
  }

  // ---- summary ----
  if (summarising) {
    const discarded = drafts.length - kept;
    return (
      <div className="space-y-5">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Ready to save</h1>
          <p className="text-sm text-muted-foreground">
            {kept} card{kept === 1 ? '' : 's'} to save
            {discarded > 0 ? `, ${discarded} discarded` : ''} · pipeline cost ${run.costUsd.toFixed(2)}
          </p>
        </header>

        <div className="flex gap-2">
          <Button size="lg" onClick={save} disabled={submitting || kept === 0}>
            {submitting ? 'Saving…' : `Save ${kept} card${kept === 1 ? '' : 's'}`}
          </Button>
          <Button size="lg" variant="outline" onClick={goBack} disabled={submitting}>
            Back to triage
          </Button>
        </div>

        {kept === 0 && (
          <p className="text-sm text-muted-foreground">Everything was discarded — nothing will be saved.</p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="space-y-3 pt-2">
          {drafts.map((card, i) =>
            decisions[i] === 'keep' ? (
              <Flashcard key={i} card={{ ...card, topic: card.topicSlug }} />
            ) : null,
          )}
        </div>
      </div>
    );
  }

  // ---- done (approved earlier) — the server component renders the saved cards ----
  return null;
}
