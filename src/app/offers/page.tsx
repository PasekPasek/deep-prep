import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/db';

import { OfferForm } from './offer-form';

export const dynamic = 'force-dynamic';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  done: 'secondary',
  failed: 'destructive',
  awaiting_approval: 'default',
};

export default async function OffersPage() {
  const { data: offers } = await db()
    .from('offers')
    .select(
      'id, company, role, seniority, raw_input, created_at, runs(id, status, created_at), card_offers(card_id, cards(status, review_state(state)))',
    )
    .order('created_at', { ascending: false })
    // With Run again an offer can have several runs — the row must link the latest.
    .order('created_at', { referencedTable: 'runs', ascending: false })
    .limit(50);

  // Readiness: the share of an offer's active cards that FSRS has promoted to
  // Review (state >= 2) — i.e. material you demonstrably know, not just collected.
  const readiness = (offer: NonNullable<typeof offers>[number]) => {
    const links = (offer.card_offers ?? []) as unknown as {
      cards: { status: string; review_state: { state: number } | null } | null;
    }[];
    const active = links.filter((l) => l.cards && l.cards.status === 'active');
    if (active.length === 0) return null;
    const ready = active.filter((l) => (l.cards!.review_state?.state ?? 0) >= 2).length;
    return { total: active.length, ready, pct: Math.round((ready / active.length) * 100) };
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Offers</h1>
        <p className="text-sm text-muted-foreground">
          Paste a job offer URL. The pipeline extracts requirements, plans topics, and drafts cards
          from your corpus for review.
        </p>
      </div>

      <OfferForm />

      {(offers ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No offers yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Role</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Cards</TableHead>
              <TableHead>Ready</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(offers ?? []).map((offer) => {
              const run = (offer.runs as { id: string; status: string }[] | null)?.[0];
              const cardCount = (offer.card_offers as { card_id: string }[] | null)?.length ?? 0;
              const ready = readiness(offer);
              return (
                <TableRow key={offer.id}>
                  <TableCell className="font-medium">
                    {run ? (
                      <Link href={`/offers/${run.id}/run`} className="underline underline-offset-4">
                        {offer.role ?? 'Pending extraction'}
                      </Link>
                    ) : (
                      (offer.role ?? 'Pending extraction')
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{offer.company ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{cardCount || '—'}</TableCell>
                  <TableCell>
                    {ready ? (
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                          <span
                            className="block h-full rounded-full bg-green-700 dark:bg-green-500"
                            style={{ width: `${ready.pct}%` }}
                          />
                        </span>
                        <span className="text-xs text-muted-foreground">{ready.pct}%</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {run ? (
                      <Badge variant={STATUS_VARIANT[run.status] ?? 'outline'}>
                        {run.status.replace(/_/g, ' ')}
                      </Badge>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
