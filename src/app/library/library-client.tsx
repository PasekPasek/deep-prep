'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Flashcard, type FlashcardData } from '@/components/flashcard';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type LibraryCard = FlashcardData & {
  id: string;
  state: string | null;
  suspended: boolean;
};

/**
 * Browsable card pool. Answers start hidden — a library you can read with the answers
 * showing is a spoiler, not a study tool. Click a card (or use Reveal all) to open it.
 */
export function LibraryClient({ groups }: { groups: [string, LibraryCard[]][] }) {
  const router = useRouter();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [allOpen, setAllOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function setStatus(id: string, status: 'active' | 'suspended') {
    setBusy(id);
    setError(null);
    try {
      const response = await fetch(`/api/cards/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error(((await response.json()) as { error?: string }).error ?? 'failed');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'update failed');
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    setError(null);
    try {
      const response = await fetch(`/api/cards/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(((await response.json()) as { error?: string }).error ?? 'failed');
      setConfirmingDelete(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'delete failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-3">
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setAllOpen((v) => !v);
            setOpen(new Set());
          }}
        >
          {allOpen ? 'Hide all answers' : 'Reveal all answers'}
        </Button>
      </div>

      {groups.map(([topic, cards]) => (
        <section key={topic} className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            {topic} · {cards.length}
          </h2>
          {cards.map((card) => {
            const revealed = allOpen || open.has(card.id);
            return (
              <div key={card.id} role="button" tabIndex={0} aria-expanded={revealed}
                onClick={() => toggle(card.id)}
                onKeyDown={(e) => {
                  if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    toggle(card.id);
                  }
                }}
                className="block w-full cursor-pointer text-left"
              >
                <Flashcard
                  card={card}
                  revealed={revealed}
                  className={cn(
                    'transition-colors hover:border-foreground/30',
                    card.suspended && 'opacity-50',
                  )}
                  footer={
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>
                        {card.suspended ? 'suspended · ' : ''}
                        {card.state ?? ''}
                        {!revealed && ' · click to reveal'}
                      </span>
                      {revealed && (
                        <span
                          className="ml-auto flex items-center gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy === card.id}
                            onClick={() => setStatus(card.id, card.suspended ? 'active' : 'suspended')}
                          >
                            {card.suspended ? 'Reactivate' : 'Suspend'}
                          </Button>
                          {confirmingDelete === card.id ? (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive"
                                disabled={busy === card.id}
                                onClick={() => remove(card.id)}
                              >
                                Really delete
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(null)}>
                                Cancel
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              onClick={() => setConfirmingDelete(card.id)}
                            >
                              Delete
                            </Button>
                          )}
                        </span>
                      )}
                    </div>
                  }
                />
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
