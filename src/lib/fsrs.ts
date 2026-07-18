import {
  createEmptyCard,
  fsrs,
  Rating,
  type Card,
  type Grade,
  type RecordLogItem,
  type State,
} from 'ts-fsrs';

import type { Database } from './database.types';

/**
 * Thin wrapper over ts-fsrs. Scheduling maths stays in the library — this file only
 * translates between a ts-fsrs `Card` and a `review_state` row.
 *
 * The translation must be lossless in both directions. `learning_steps` in particular
 * is easy to overlook: drop it and a learning-phase card restarts at step 0 after
 * every review, so it never graduates.
 */

export type ReviewStateRow = Database['public']['Tables']['review_state']['Row'];
export type ReviewStateInsert = Database['public']['Tables']['review_state']['Insert'];
export type ReviewLogInsert = Database['public']['Tables']['review_log']['Insert'];

const scheduler = fsrs();

/** 1..4 as stored in review_log.rating. Rating.Manual (0) is never persisted. */
export const RATINGS = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
} as const;

export function isGrade(value: number): value is Grade {
  return value === Rating.Again || value === Rating.Hard || value === Rating.Good || value === Rating.Easy;
}

/** Fresh card, due immediately — a newly approved card enters the queue today. */
export function initialReviewState(cardId: string): ReviewStateInsert {
  return toRow(cardId, createEmptyCard());
}

export function toRow(cardId: string, card: Card): ReviewStateInsert {
  return {
    card_id: cardId,
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? card.last_review.toISOString() : null,
  };
}

export function fromRow(row: ReviewStateRow): Card {
  return {
    due: new Date(row.due),
    // Nullable in the schema only because §4 declared them without defaults; a row
    // written by toRow always carries real numbers.
    stability: row.stability ?? 0,
    difficulty: row.difficulty ?? 0,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    reps: row.reps ?? 0,
    lapses: row.lapses ?? 0,
    state: row.state as State,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
  };
}

/**
 * Apply a rating. Returns the next review_state row plus the log entry to append —
 * the caller persists both in one operation so state and history cannot diverge.
 */
export function applyRating(
  row: ReviewStateRow,
  grade: Grade,
  now: Date = new Date(),
): { state: ReviewStateInsert; log: ReviewLogInsert } {
  const result: RecordLogItem = scheduler.next(fromRow(row), now, grade);

  return {
    state: toRow(row.card_id, result.card),
    log: {
      card_id: row.card_id,
      rating: grade,
      reviewed_at: now.toISOString(),
      elapsed_days: result.log.elapsed_days,
      scheduled_days: result.log.scheduled_days,
    },
  };
}

/** The four outcomes, for showing "how far each button pushes this card" in the UI. */
export function previewIntervals(row: ReviewStateRow, now: Date = new Date()) {
  const preview = scheduler.repeat(fromRow(row), now);
  return {
    again: preview[Rating.Again].card.due,
    hard: preview[Rating.Hard].card.due,
    good: preview[Rating.Good].card.due,
    easy: preview[Rating.Easy].card.due,
  };
}
