'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Start a fresh run on an existing offer. Safe since the critic phase: cards the
 * pool already has are absorbed as links, not regenerated as near-copies.
 */
export function RunAgainButton({ offerId }: { offerId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runAgain() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offerId }),
      });
      const body = (await response.json()) as { runId?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      router.push(`/offers/${body.runId}/run`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'starting run failed');
      setPending(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-3">
      <Button variant="outline" size="sm" onClick={runAgain} disabled={pending}>
        {pending ? 'Starting…' : 'Run again'}
      </Button>
      {error && <span className="text-sm text-destructive">{error}</span>}
    </span>
  );
}
