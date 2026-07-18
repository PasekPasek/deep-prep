'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Submit a job offer URL and jump straight to its run view. */
export function OfferForm() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!url.trim() || pending) return;

    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const body = (await response.json()) as { runId?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);

      router.push(`/offers/${body.runId}/run`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'submission failed');
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex gap-2">
        <Input
          type="url"
          required
          placeholder="https://justjoin.it/offers/..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={pending}
        />
        <Button type="submit" disabled={pending || !url.trim()}>
          {pending ? 'Starting…' : 'Generate cards'}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
