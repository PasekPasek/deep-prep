/**
 * Drive one offer through the pipeline from the CLI — `pnpm pipeline <url>`.
 *
 * The same orchestrator the API routes use, run in a single process so output is
 * visible while iterating on prompts. Stops at awaiting_approval; approving is a
 * deliberate act that belongs in the UI.
 *
 * `--text <file>` substitutes a local file for fetching, useful when a job board
 * blocks scripted requests or when re-running a fixed offer while tuning prompts.
 */
import { readFileSync } from 'node:fs';

import { db } from '../src/lib/db';
import { flushTelemetry, initTelemetry } from '../src/lib/telemetry';
import { defaultDeps, runToCompletion } from '../src/orchestrator/run';
import { createRun, getDraftCards, loadRun } from '../src/orchestrator/state';

async function main() {
  const traced = await initTelemetry();
  if (traced) console.log('tracing to Langfuse\n');

  const args = process.argv.slice(2);
  const textFlag = args.indexOf('--text');
  const localText = textFlag !== -1 ? readFileSync(args[textFlag + 1], 'utf8') : null;
  const url = args.find((a) => a.startsWith('http')) ?? 'https://example.com/offer';

  const { data: offer, error } = await db()
    .from('offers')
    .insert({ input_kind: 'url', raw_input: url })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  const run = await createRun(offer.id);
  console.log(`run ${run.id}\noffer ${offer.id}\n`);

  const deps = localText ? { ...defaultDeps, fetchOfferText: async () => localText } : defaultDeps;

  const started = Date.now();
  const outcome = await runToCompletion(run.id, deps);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  const final = await loadRun(run.id);
  const cards = getDraftCards(final);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`status ${final.status} · ${seconds}s · $${Number(final.cost_usd).toFixed(4)} · ${cards.length} cards`);
  if (final.error) console.log(`error: ${final.error}`);
  console.log('='.repeat(70));

  const { data: offerRow } = await db().from('offers').select('extracted').eq('id', offer.id).single();
  if (offerRow?.extracted) {
    const e = offerRow.extracted as { company: string; role: string; seniority: string; mustHave: string[]; niceToHave: string[] };
    console.log(`\nEXTRACTED: ${e.role} @ ${e.company} (${e.seniority})`);
    console.log(`  must have: ${e.mustHave.join(', ')}`);
    console.log(`  nice to have: ${e.niceToHave.join(', ')}`);
  }

  const plan = final.plan as { topics: { slug: string; name: string; estimatedCards: number }[] } | null;
  if (plan) {
    console.log(`\nPLANNED TOPICS (${plan.topics.length}):`);
    for (const t of plan.topics) {
      const written = cards.filter((c) => c.topicSlug === t.slug).length;
      console.log(`  ${t.slug} — est ${t.estimatedCards}, written ${written}`);
    }
  }

  if (cards.length > 0) {
    console.log(`\nCARDS:\n`);
    for (const [i, card] of cards.entries()) {
      console.log(`[${i + 1}] (${card.kind}) ${card.topicSlug}`);
      console.log(`  Q: ${card.front}`);
      console.log(`  A: ${card.back}`);
      console.log(`  src: ${card.provenance.map((p) => p.label ?? p.ref).join(' · ')}\n`);
    }
  }

  console.log(`Review in the UI: /offers/${run.id}/run`);
  void outcome;
}

main()
  .then(flushTelemetry)
  .catch(async (error) => {
    console.error(error);
    await flushTelemetry();
    process.exit(1);
  });
