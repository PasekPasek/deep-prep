'use client';

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
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [allOpen, setAllOpen] = useState(false);

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
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
              <button
                key={card.id}
                type="button"
                onClick={() => toggle(card.id)}
                aria-expanded={revealed}
                className="block w-full text-left"
              >
                <Flashcard
                  card={card}
                  revealed={revealed}
                  className={cn(
                    'transition-colors hover:border-foreground/30',
                    card.suspended && 'opacity-50',
                  )}
                  footer={
                    <p className="text-xs text-muted-foreground">
                      {card.suspended ? 'suspended · ' : ''}
                      {card.state ?? ''}
                      {!revealed && ' · click to reveal'}
                    </p>
                  }
                />
              </button>
            );
          })}
        </section>
      ))}
    </div>
  );
}
