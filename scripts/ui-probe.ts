/**
 * Temporary probe: insert one due card so the UI can be checked with real data,
 * then remove it. `--cleanup` deletes without inserting.
 */
import { db } from '../src/lib/db';
import { initialReviewState } from '../src/lib/fsrs';

const PROBE_SLUG = '__ui-probe__';

async function cleanup() {
  const s = db();
  const { data: topic } = await s.from('topics').select('id').eq('slug', PROBE_SLUG).maybeSingle();
  if (!topic) return console.log('nothing to clean');

  const { data: cards } = await s.from('cards').select('id').eq('topic_id', topic.id);
  for (const card of cards ?? []) {
    await s.from('review_log').delete().eq('card_id', card.id);
    await s.from('review_state').delete().eq('card_id', card.id);
  }
  await s.from('cards').delete().eq('topic_id', topic.id);
  await s.from('topics').delete().eq('id', topic.id);
  console.log(`removed probe topic and ${cards?.length ?? 0} card(s)`);
}

async function insert() {
  const s = db();
  const { data: topic, error: topicError } = await s
    .from('topics')
    .upsert({ slug: PROBE_SLUG, name: 'UI Probe' }, { onConflict: 'slug' })
    .select('id')
    .single();
  if (topicError) throw new Error(topicError.message);

  const { data: card, error: cardError } = await s
    .from('cards')
    .insert({
      topic_id: topic.id,
      kind: 'interview_question',
      front: 'PROBEFRONT What is a closure in JavaScript?',
      back: 'PROBEBACK A function together with the lexical scope it captured at creation.',
      provenance: [{ kind: 'corpus', ref: 'sec-1', label: 'handbook › JS › Closures' }],
      status: 'active',
    })
    .select('id')
    .single();
  if (cardError) throw new Error(cardError.message);

  const { error: stateError } = await s.from('review_state').insert(initialReviewState(card.id));
  if (stateError) throw new Error(stateError.message);

  console.log(`probe card inserted: ${card.id}`);
}

const run = process.argv.includes('--cleanup') ? cleanup : insert;
run().catch((error) => {
  console.error(error);
  process.exit(1);
});
