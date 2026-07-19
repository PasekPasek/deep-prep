'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Submit a job offer as a URL or a screenshot; either way the pipeline starts and we
 * jump straight to the run view. One form, two inputs — pasting a URL and dropping a
 * screenshot are the same action in the user's head, so they live side by side.
 */
export function OfferForm() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState('');
  const [pending, setPending] = useState<'url' | 'file' | 'text' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(request: Promise<Response>) {
    setError(null);
    try {
      const response = await request;
      const body = (await response.json()) as { runId?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      router.push(`/offers/${body.runId}/run`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'submission failed');
      setPending(null);
    }
  }

  function submitUrl(event: React.FormEvent) {
    event.preventDefault();
    if (!url.trim() || pending) return;
    setPending('url');
    void start(
      fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      }),
    );
  }

  function submitFile(file: File) {
    if (pending) return;
    setPending('file');
    const form = new FormData();
    form.append('file', file);
    void start(fetch('/api/pipeline/screenshot', { method: 'POST', body: form }));
  }

  return (
    <div className="space-y-2">
      <form onSubmit={submitUrl} className="flex gap-2">
        <Input
          type="url"
          required
          placeholder="https://justjoin.it/offers/..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={pending !== null}
        />
        <Button type="submit" disabled={pending !== null || !url.trim()}>
          {pending === 'url' ? 'Starting…' : 'Generate cards'}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) submitFile(file);
            e.target.value = '';
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={pending !== null}
          onClick={() => fileInput.current?.click()}
        >
          {pending === 'file' ? 'Uploading…' : 'Screenshot…'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending !== null}
          onClick={() => setCustomOpen((v) => !v)}
        >
          Custom…
        </Button>
      </form>

      {customOpen && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (customText.trim().length < 10 || pending) return;
            setPending('text');
            void start(
              fetch('/api/pipeline', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: customText.trim() }),
              }),
            );
          }}
          className="space-y-2"
        >
          <textarea
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            disabled={pending !== null}
            rows={3}
            placeholder={'No offer needed — describe what to study, e.g.\n"TypeScript, React, Kubernetes — senior frontend developer"'}
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" disabled={pending !== null || customText.trim().length < 10}>
            {pending === 'text' ? 'Starting…' : 'Generate from description'}
          </Button>
        </form>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
