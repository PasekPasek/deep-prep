import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * The one way a flashcard is rendered anywhere in the app.
 *
 * Looks like an index card on purpose: red top rule, serif faces, a ruled divider
 * between question and answer. The card content is typeset in a reading serif while
 * all surrounding chrome stays in the UI sans — the study material should feel like
 * material, not like a form.
 */

export type FlashcardData = {
  front: string;
  back: string;
  kind: string;
  topic?: string | null;
  provenance?: { label?: string; ref: string }[] | null;
};

const KIND_LABEL: Record<string, string> = {
  concept: 'concept',
  interview_question: 'interview',
  coding_task: 'coding',
};

export function Flashcard({
  card,
  revealed = true,
  size = 'md',
  footer,
  className,
}: {
  card: FlashcardData;
  /** When false, only the question shows — the reviews flow controls revealing. */
  revealed?: boolean;
  size?: 'md' | 'lg';
  /** Extra row rendered inside the card, under the content (e.g. actions). */
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border bg-card shadow-sm',
        'border-t-[3px] border-t-red-800/60',
        className,
      )}
    >
      <div className={cn('flex flex-col', size === 'lg' ? 'gap-5 p-8' : 'gap-4 p-5')}>
        <div className="flex items-center gap-2 text-xs">
          {card.topic && <Badge variant="secondary">{card.topic}</Badge>}
          <span className="uppercase tracking-widest text-muted-foreground">
            {KIND_LABEL[card.kind] ?? card.kind}
          </span>
        </div>

        <p
          className={cn(
            'font-serif whitespace-pre-wrap text-balance leading-snug',
            size === 'lg' ? 'text-2xl' : 'text-lg',
          )}
        >
          {card.front}
        </p>

        {revealed && (
          <>
            <hr className="border-border" />
            <div
              className={cn(
                'font-serif whitespace-pre-wrap leading-relaxed text-foreground/90',
                size === 'lg' ? 'text-lg' : 'text-base',
              )}
            >
              {card.back}
            </div>
          </>
        )}

        {revealed && card.provenance && card.provenance.length > 0 && (
          <p className="font-mono text-[11px] leading-tight text-muted-foreground">
            {card.provenance.map((p) => p.label ?? p.ref).join('  ·  ')}
          </p>
        )}

        {footer}
      </div>
    </div>
  );
}

/** Small keyboard hint chip: <Kbd>Space</Kbd>. */
export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
      {children}
    </kbd>
  );
}
