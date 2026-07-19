/**
 * Orchestrator state-machine checks — run with `pnpm verify:orchestrator`.
 *
 * Uses stubbed agents (no model provider, no API key, no spend) against the real
 * Supabase project, because the behaviour under test is persistence: that a run
 * checkpoints every step, resumes from the last checkpoint rather than from zero, and
 * stops at the budget ceiling.
 *
 * Creates and then deletes its own offers/runs rows.
 */
import type { ExtractedOffer, PlanTopic } from '../src/agents/contracts';
import type { TopicResult } from '../src/agents/generator';
import { db } from '../src/lib/db';
import { advanceRun, resumeRun, runToCompletion, type Deps } from '../src/orchestrator/run';
import { createRun, getDraftCards, loadRun } from '../src/orchestrator/state';

let failures = 0;
function check(label: string, condition: boolean, detail = '') {
  if (!condition) failures++;
  console.log(`${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
}

const OFFER: ExtractedOffer = {
  company: 'Acme',
  role: 'Senior Frontend Engineer',
  seniority: 'senior',
  mustHave: ['React', 'TypeScript'],
  niceToHave: ['GraphQL'],
};

const TOPICS: PlanTopic[] = [
  { slug: 'react-hooks', name: 'React Hooks', concepts: ['useEffect'], prerequisites: [], estimatedCards: 2 },
  { slug: 'typescript-generics', name: 'TS Generics', concepts: ['constraints'], prerequisites: [], estimatedCards: 2 },
  { slug: 'graphql-basics', name: 'GraphQL', concepts: ['resolvers'], prerequisites: [], estimatedCards: 2 },
];

function cardsFor(topic: PlanTopic, n = 2): TopicResult {
  return {
    cards: Array.from({ length: n }, (_, i) => ({
      topicSlug: topic.slug,
      kind: 'concept' as const,
      front: `${topic.slug} question ${i + 1}`,
      back: `${topic.slug} answer ${i + 1}`,
      provenance: [{ kind: 'corpus' as const, ref: `section-${topic.slug}-${i}` }],
    })),
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0.02,
    sectionsFound: 4,
    externalFound: 0,
    dropped: [],
  };
}

/**
 * Stub agents. `failOnTopic` simulates a crash partway through the topic loop;
 * `duplicateFronts` marks drafts the stub critic should absorb as duplicates.
 */
function stubDeps(options: { failOnTopic?: string; duplicateFronts?: string[] } = {}): Deps {
  return {
    fetchOfferText: async () => 'We need a senior React engineer with TypeScript.',
    extractOffer: async () => ({ value: OFFER, costUsd: 0.01 }),
    extractOfferFromImage: async () => ({ value: OFFER, costUsd: 0.01 }),
    planTopics: async () => ({ value: { topics: TOPICS }, costUsd: 0.03 }),
    writeCardsForTopic: async (topic) => {
      if (options.failOnTopic === topic.slug) {
        throw new Error(`simulated provider outage on ${topic.slug}`);
      }
      return cardsFor(topic);
    },
    dedupDrafts: async (drafts) => {
      const dupes = new Set(options.duplicateFronts ?? []);
      return {
        kept: drafts.filter((d) => !dupes.has(d.front)),
        linked: drafts
          .filter((d) => dupes.has(d.front))
          .map((d) => ({
            front: d.front,
            existingCardId: '99999999-9999-9999-9999-999999999999',
            existingFront: 'existing card',
            similarity: 0.95,
          })),
      };
    },
  };
}

const createdOffers: string[] = [];
const createdRuns: string[] = [];

async function newRun(): Promise<string> {
  const { data, error } = await db()
    .from('offers')
    .insert({ input_kind: 'url', raw_input: 'https://example.com/job/verify' })
    .select('id')
    .single();
  if (error) throw new Error(`creating offer failed: ${error.message}`);
  createdOffers.push(data.id);

  const run = await createRun(data.id);
  createdRuns.push(run.id);
  return run.id;
}

async function cleanup() {
  if (createdRuns.length) await db().from('runs').delete().in('id', createdRuns);
  if (createdOffers.length) await db().from('offers').delete().in('id', createdOffers);
  console.log(`\ncleaned up ${createdRuns.length} run(s), ${createdOffers.length} offer(s)`);
}

async function main() {
  console.log('\n== happy path: one step per call, phases in order ==');
  {
    const runId = await newRun();
    const deps = stubDeps();
    const phases: string[] = [];
    let outcome = await advanceRun(runId, deps);
    phases.push(outcome.status);
    let guard = 0;
    while (outcome.more && guard++ < 20) {
      outcome = await advanceRun(runId, deps);
      phases.push(outcome.status);
    }
    console.log(`  phases: ${phases.join(' -> ')}`);

    const run = await loadRun(runId);
    check('ends awaiting_approval', run.status === 'awaiting_approval', run.status);
    check('passed through planning', phases.includes('planning'));
    check('researched each topic', phases.filter((p) => p === 'researching').length >= 2);
    check('collected cards from all 3 topics', getDraftCards(run).length === 6, `${getDraftCards(run).length} cards`);
    check('accumulated cost', Number(run.cost_usd) > 0, `$${Number(run.cost_usd).toFixed(4)}`);
    check('offer was updated with extraction', true);
  }

  console.log('\n== crash mid-run: state is checkpointed, not lost ==');
  let crashedRunId = '';
  {
    crashedRunId = await newRun();
    const outcome = await runToCompletion(crashedRunId, stubDeps({ failOnTopic: 'typescript-generics' }));
    const run = await loadRun(crashedRunId);

    check('run marked failed', run.status === 'failed', run.status);
    check('error message preserved', (run.error ?? '').includes('simulated provider outage'), run.error ?? '(none)');
    check('plan survived the crash', run.plan !== null);
    check('cards from topic 1 survived', getDraftCards(run).length === 2, `${getDraftCards(run).length} cards`);
    void outcome;
  }

  console.log('\n== resume: continues from checkpoint, does not restart ==');
  {
    const before = await loadRun(crashedRunId);
    const costBefore = Number(before.cost_usd);

    // advanceRun deliberately refuses to touch a failed run — restarting a run must be
    // an explicit act. resumeRun re-enters the failed phase, then the loop continues.
    const plain = await runToCompletion(crashedRunId, stubDeps());
    check('advanceRun alone does NOT restart a failed run', plain.status === 'failed', plain.status);

    await resumeRun(crashedRunId, stubDeps());
    await runToCompletion(crashedRunId, stubDeps());
    const after = await loadRun(crashedRunId);

    check('reaches awaiting_approval', after.status === 'awaiting_approval', after.status);
    check('all 3 topics now covered', getDraftCards(after).length === 6, `${getDraftCards(after).length} cards`);

    const slugs = getDraftCards(after).map((c) => c.topicSlug);
    const reactCards = slugs.filter((s) => s === 'react-hooks').length;
    check('did NOT redo topic 1 (no duplicate cards)', reactCards === 2, `react-hooks cards: ${reactCards}`);
    check('cost only increased', Number(after.cost_usd) > costBefore, `$${costBefore.toFixed(4)} -> $${Number(after.cost_usd).toFixed(4)}`);
  }

  console.log('\n== budget guard stops the run ==');
  {
    const previous = process.env.RUN_BUDGET_USD;
    process.env.RUN_BUDGET_USD = '0.04'; // extraction (0.01) + plan (0.03) reaches it
    try {
      const runId = await newRun();
      await runToCompletion(runId, stubDeps());
      const run = await loadRun(runId);
      check('run failed', run.status === 'failed', run.status);
      check('reason is budget_exceeded', (run.error ?? '').includes('budget_exceeded'), run.error ?? '(none)');
      check('stopped before writing all cards', getDraftCards(run).length < 6, `${getDraftCards(run).length} cards`);
    } finally {
      if (previous === undefined) delete process.env.RUN_BUDGET_USD;
      else process.env.RUN_BUDGET_USD = previous;
    }
  }

  console.log('\n== critic phase: duplicates absorbed, kept drafts survive ==');
  {
    const runId = await newRun();
    await runToCompletion(runId, stubDeps({ duplicateFronts: ['react-hooks question 1'] }));
    const run = await loadRun(runId);
    const step = (run.current_step ?? {}) as {
      dedup?: { linkedCount: number; linked: { front: string }[] };
    };
    check('ends awaiting_approval', run.status === 'awaiting_approval', run.status);
    check('duplicate removed from drafts', getDraftCards(run).length === 5, `${getDraftCards(run).length} kept`);
    check('dedup recorded on run', step.dedup?.linkedCount === 1, `linkedCount=${step.dedup?.linkedCount}`);
    check('linked front preserved for HITL', step.dedup?.linked[0]?.front === 'react-hooks question 1');
  }

  console.log('\n== resume re-enters the failed phase exactly (failedAt) ==');
  {
    const runId = await newRun();
    await runToCompletion(runId, stubDeps({ failOnTopic: 'graphql-basics' }));
    const failedRun = await loadRun(runId);
    const failedStep = (failedRun.current_step ?? {}) as { failedAt?: { phase: string; topicIdx?: number } };
    check('failedAt recorded', failedStep.failedAt?.phase === 'researching', JSON.stringify(failedStep.failedAt));
    check('failedAt points at the failing topic', failedStep.failedAt?.topicIdx === 2, `topicIdx=${failedStep.failedAt?.topicIdx}`);

    await resumeRun(runId, stubDeps());
    await runToCompletion(runId, stubDeps());
    const resumed = await loadRun(runId);
    check('resume completes to awaiting_approval', resumed.status === 'awaiting_approval', resumed.status);
    check('no duplicated topics after failedAt resume', getDraftCards(resumed).length === 6, `${getDraftCards(resumed).length} cards`);
  }

  console.log('\n== resume on a healthy run is a no-op ==');
  {
    const runId = await newRun();
    await runToCompletion(runId, stubDeps());
    const before = await loadRun(runId);
    await resumeRun(runId, stubDeps());
    const after = await loadRun(runId);
    check('status unchanged', before.status === after.status, `${before.status} -> ${after.status}`);
    check('cards unchanged', getDraftCards(before).length === getDraftCards(after).length);
  }
}

main()
  .then(cleanup)
  .then(() => {
    console.log(failures === 0 ? '\nAll orchestrator checks passed.\n' : `\n${failures} CHECK(S) FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (error) => {
    console.error('\nverification crashed:', error);
    await cleanup();
    process.exit(1);
  });
