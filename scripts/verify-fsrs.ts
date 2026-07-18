/**
 * Smoke check for src/lib/fsrs.ts — run with `pnpm verify:fsrs`.
 *
 * Guards the DB <-> ts-fsrs translation, which is silent when wrong: a dropped field
 * produces plausible-looking due dates while quietly corrupting the schedule.
 */
import { createEmptyCard } from 'ts-fsrs';

import { applyRating, fromRow, initialReviewState, RATINGS, toRow } from '../src/lib/fsrs';
import type { ReviewStateRow } from '../src/lib/fsrs';

let failures = 0;

function check(label: string, condition: boolean, detail = '') {
  const mark = condition ? '✓' : '✗';
  if (!condition) failures++;
  console.log(`${mark} ${label}${detail ? ` — ${detail}` : ''}`);
}

// A row as it comes back from Postgres (Insert has optional fields, Row does not).
function asRow(insert: ReturnType<typeof initialReviewState>): ReviewStateRow {
  return {
    card_id: insert.card_id,
    due: insert.due,
    stability: insert.stability ?? 0,
    difficulty: insert.difficulty ?? 0,
    elapsed_days: insert.elapsed_days ?? 0,
    scheduled_days: insert.scheduled_days ?? 0,
    learning_steps: insert.learning_steps ?? 0,
    reps: insert.reps ?? 0,
    lapses: insert.lapses ?? 0,
    state: insert.state ?? 0,
    last_review: insert.last_review ?? null,
  };
}

console.log('\n== round-trip fidelity ==');
const empty = createEmptyCard();
const restored = fromRow(asRow(toRow('11111111-1111-1111-1111-111111111111', empty)));

check('due survives', restored.due.getTime() === empty.due.getTime());
check('stability survives', restored.stability === empty.stability);
check('difficulty survives', restored.difficulty === empty.difficulty);
check('state survives', restored.state === empty.state);
check('learning_steps survives', restored.learning_steps === empty.learning_steps);
check('scheduled_days survives', restored.scheduled_days === empty.scheduled_days);

console.log('\n== scheduling advances state ==');
const t0 = new Date('2026-07-18T10:00:00Z');
let row = asRow(initialReviewState('22222222-2222-2222-2222-222222222222'));

const first = applyRating(row, RATINGS.good, t0);
check('reps incremented', first.state.reps === 1, `reps=${first.state.reps}`);
check('due moved forward', new Date(first.state.due) > t0, `due=${first.state.due}`);
check('log rating recorded', first.log.rating === RATINGS.good);
check('last_review set', first.state.last_review !== null);

console.log('\n== learning_steps persists across reviews ==');
// Walk several reviews through the DB representation each time, exactly as the app
// does. If learning_steps were dropped on persistence, the card would be pinned to
// step 0 and never graduate out of the learning state.
row = asRow(initialReviewState('33333333-3333-3333-3333-333333333333'));
const seen: number[] = [];
let clock = t0;
for (let i = 0; i < 4; i++) {
  const next = applyRating(row, RATINGS.good, clock);
  row = asRow(next.state);
  seen.push(row.learning_steps);
  clock = new Date(row.due);
}
console.log(`  learning_steps across 4 reviews: [${seen.join(', ')}]`);
console.log(`  final state (0=New 1=Learning 2=Review 3=Relearning): ${row.state}`);
check('card left the New state', row.state !== 0);
check('card reached Review', row.state === 2, `state=${row.state}`);

console.log('\n== Again resets appropriately ==');
const lapsed = applyRating(row, RATINGS.again, new Date(row.due));
check('lapses incremented', (lapsed.state.lapses ?? 0) > (row.lapses ?? 0), `${row.lapses} -> ${lapsed.state.lapses}`);

console.log(failures === 0 ? '\nAll FSRS checks passed.\n' : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
