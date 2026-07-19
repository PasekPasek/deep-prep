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
    .select('id, company, role, seniority, raw_input, created_at, runs(id, status, created_at), card_offers(card_id)')
    .order('created_at', { ascending: false })
    // With Run again an offer can have several runs — the row must link the latest.
    .order('created_at', { referencedTable: 'runs', ascending: false })
    .limit(50);

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
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(offers ?? []).map((offer) => {
              const run = (offer.runs as { id: string; status: string }[] | null)?.[0];
              const cardCount = (offer.card_offers as { card_id: string }[] | null)?.length ?? 0;
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
