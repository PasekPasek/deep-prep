/**
 * Review API checks — run with `pnpm verify:reviews` while `pnpm dev` is running.
 *
 * Exercises the real HTTP routes against the real database: due queue, rating, FSRS
 * rescheduling, and the review log. No model provider involved, so this needs no API
 * key and costs nothing.
 *
 * Creates and deletes its own topic/card/review rows.
 */
import { db } from '../src/lib/db';
import { initialReviewState } from '../src/lib/fsrs';

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000';

let failures = 0;
function check(label: string, condition: boolean, detail = '') {
  if (!condition) failures++;
  console.log(`${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
}

let cardId = '';
let topicId = '';

async function setup() {
  const supabase = db();

  const { data: topic, error: topicError } = await supabase
    .from('topics')
    .upsert({ slug: '__verify-topic__', name: 'Verify Topic' }, { onConflict: 'slug' })
    .select('id')
    .single();
  if (topicError) throw new Error(`topic: ${topicError.message}`);
  topicId = topic.id;

  const { data: card, error: cardError } = await supabase
    .from('cards')
    .insert({
      topic_id: topicId,
      kind: 'concept',
      front: '__verify__ What does useEffect return?',
      back: '__verify__ An optional cleanup function.',
      provenance: [{ kind: 'corpus', ref: 'verify-section' }],
      status: 'active',
    })
    .select('id')
    .single();
  if (cardError) throw new Error(`card: ${cardError.message}`);
  cardId = card.id;

  const { error: stateError } = await supabase.from('review_state').insert(initialReviewState(cardId));
  if (stateError) throw new Error(`review_state: ${stateError.message}`);
}

async function teardown() {
  const supabase = db();
  if (cardId) {
    await supabase.from('review_log').delete().eq('card_id', cardId);
    await supabase.from('review_state').delete().eq('card_id', cardId);
    await supabase.from('cards').delete().eq('id', cardId);
  }
  if (topicId) await supabase.from('topics').delete().eq('id', topicId);
  console.log('\ncleaned up verify rows');
}

async function main() {
  await setup();
  console.log(`card under test: ${cardId}\n`);

  console.log('== GET /api/reviews returns the due card ==');
  const queueResponse = await fetch(`${BASE}/api/reviews`);
  check('HTTP 200', queueResponse.status === 200, `got ${queueResponse.status}`);
  const queue = (await queueResponse.json()) as { due: { cardId: string; front: string; back: string }[] };
  const mine = queue.due.find((c) => c.cardId === cardId);
  check('new card appears in the queue', mine !== undefined, `${queue.due.length} card(s) due`);
  check('front and back are returned', Boolean(mine?.front && mine?.back));

  console.log('\n== POST /api/reviews reschedules via FSRS ==');
  const before = await loadState();
  const rateResponse = await fetch(`${BASE}/api/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cardId, rating: 3 }), // Good
  });
  check('HTTP 200', rateResponse.status === 200, `got ${rateResponse.status}`);
  const rated = (await rateResponse.json()) as { due: string; reps: number; state: number };

  const after = await loadState();
  check('due moved into the future', new Date(after.due) > new Date(), `due=${after.due}`);
  check('due advanced from before', new Date(after.due) > new Date(before.due));
  check('reps incremented', (after.reps ?? 0) === (before.reps ?? 0) + 1, `${before.reps} -> ${after.reps}`);
  check('left the New state', after.state !== 0, `state=${after.state}`);
  check('response echoes new schedule', Boolean(rated.due));

  console.log('\n== review_log records the rating ==');
  const { data: logs } = await db().from('review_log').select('*').eq('card_id', cardId);
  check('exactly one log row', (logs ?? []).length === 1, `${(logs ?? []).length} row(s)`);
  check('rating stored as 3', logs?.[0]?.rating === 3, String(logs?.[0]?.rating));

  console.log('\n== rated card leaves the due queue ==');
  const requeue = await fetch(`${BASE}/api/reviews`);
  const requeued = (await requeue.json()) as { due: { cardId: string }[] };
  check('card no longer due', !requeued.due.some((c) => c.cardId === cardId));

  console.log('\n== validation ==');
  const bad = await fetch(`${BASE}/api/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cardId, rating: 9 }),
  });
  check('rejects out-of-range rating', bad.status === 400, `got ${bad.status}`);

  const unauthorised = await fetch(`${BASE}/api/pipeline/step`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId: '00000000-0000-0000-0000-000000000000' }),
  });
  check('internal step route rejects calls without CRON_SECRET', unauthorised.status === 401, `got ${unauthorised.status}`);
}

async function loadState() {
  const { data, error } = await db().from('review_state').select('*').eq('card_id', cardId).single();
  if (error) throw new Error(`loadState: ${error.message}`);
  return data;
}

main()
  .then(teardown)
  .then(() => {
    console.log(failures === 0 ? '\nAll review checks passed.\n' : `\n${failures} CHECK(S) FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (error) => {
    console.error('\nverification crashed:', error);
    await teardown();
    process.exit(1);
  });
