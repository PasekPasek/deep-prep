import { notFound } from 'next/navigation';

import { getDraftCards, getPlan, loadRun } from '@/orchestrator/state';

import { RunClient } from './run-client';

export const dynamic = 'force-dynamic';

/** The [id] segment is the RUN id — a run is what there is progress to show. */
export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let run;
  try {
    run = await loadRun(id);
  } catch {
    notFound();
  }

  const plan = getPlan(run);
  const step = (run.current_step ?? {}) as { topicIdx?: number };

  return (
    <RunClient
      initial={{
        id: run.id,
        status: run.status,
        error: run.error,
        costUsd: Number(run.cost_usd ?? 0),
        topics: plan?.topics.map((t) => ({ slug: t.slug, name: t.name })) ?? [],
        topicIdx: step.topicIdx ?? null,
        draftCards: getDraftCards(run),
      }}
    />
  );
}
