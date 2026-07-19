import type { ReviewStateRow } from './fsrs';
import { previewIntervals } from './fsrs';

/**
 * Human labels for "how far does each rating push this card" — shown on the rating
 * buttons, Anki-style, so a rating is an informed choice rather than a guess.
 */

export type IntervalPreview = { again: string; hard: string; good: string; easy: string };

export function humanizeDelta(from: Date, to: Date): string {
  const minutes = Math.max(1, Math.round((to.getTime() - from.getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

export function intervalPreview(row: ReviewStateRow, now: Date = new Date()): IntervalPreview {
  const preview = previewIntervals(row, now);
  return {
    again: humanizeDelta(now, preview.again),
    hard: humanizeDelta(now, preview.hard),
    good: humanizeDelta(now, preview.good),
    easy: humanizeDelta(now, preview.easy),
  };
}
