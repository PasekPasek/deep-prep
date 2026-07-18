-- review_state must round-trip a ts-fsrs `Card` losslessly.
--
-- The §4 draft schema stored due/stability/difficulty/reps/lapses/state/last_review,
-- but the ts-fsrs Card interface also carries:
--
--   learning_steps  position in the learning-step sequence. Dropping this resets a
--                   learning-phase card to step 0 on every review, so cards would
--                   never graduate out of learning.
--   scheduled_days  interval assigned at the last scheduling.
--   elapsed_days    deprecated in ts-fsrs but still part of the interface; stored so
--                   reconstruction never has to invent a value.
--
-- Without these, src/lib/fsrs.ts could not rebuild a Card from the row and would
-- feed the scheduler fabricated state.

alter table review_state
  add column learning_steps int  not null default 0,
  add column scheduled_days real not null default 0,
  add column elapsed_days   real not null default 0;
