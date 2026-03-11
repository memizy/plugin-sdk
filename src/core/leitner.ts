/**
 * Pure Leitner spaced-repetition reducer.
 * No side-effects — takes old state and returns new state.
 */

import type { Bucket, ProgressRecord, ProgressStats, ProgressLastAnswer } from '../types/oqsep';
import type { AnswerOptions } from '../types/messages';

/** Days until next review for each bucket after a correct answer. */
export const LEITNER_INTERVALS_DAYS: Record<Bucket, number> = {
  0: 0,   // "new" — set immediately for first review
  1: 1,
  2: 3,
  3: 7,
  4: 30,
};

/**
 * Compute a new `ProgressRecord` by applying the Leitner algorithm.
 *
 * Rules:
 * - **Correct:** `bucket` + 1 (max 4). Streak increments.
 * - **Incorrect:** `bucket` resets to 1. Streak resets to 0.
 * - `nextReviewAt` is set to `now + LEITNER_INTERVALS_DAYS[newBucket]`.
 *
 * @param existing  The current record for the item (or `undefined` for new items).
 * @param isCorrect Whether the answer was correct.
 * @param timeSpent Time the user spent on the item (ms), already resolved by the caller.
 * @param options   Raw answer options from the plugin consumer.
 * @returns         A fresh `ProgressRecord` — does not mutate `existing`.
 */
export function defaultLeitnerReducer(
  existing: ProgressRecord | undefined,
  isCorrect: boolean,
  timeSpent: number,
  options: AnswerOptions,
): ProgressRecord {
  const base: ProgressRecord = existing ?? {
    bucket: 0,
    stats: { attempts: 0, incorrect: 0, streak: 0 },
  };

  const oldBucket = base.bucket;
  const newBucket: Bucket = isCorrect ? (Math.min(oldBucket < 1 ? 2 : oldBucket + 1, 4) as Bucket) : 1;

  const intervalMs = LEITNER_INTERVALS_DAYS[newBucket] * 86_400_000;
  const nextReviewAt = new Date(Date.now() + intervalMs).toISOString();

  const newStats: ProgressStats = {
    attempts: base.stats.attempts + 1,
    incorrect: base.stats.incorrect + (isCorrect ? 0 : 1),
    streak: isCorrect ? base.stats.streak + 1 : 0,
  };

  const lastAnswer: ProgressLastAnswer = {
    isCorrect,
    answeredAt: new Date().toISOString(),
    timeSpent,
    confidence: options.confidence,
    hintsUsed: options.hintsUsed ?? 0,
  };

  return {
    ...base,
    bucket: newBucket,
    nextReviewAt,
    stats: newStats,
    lastAnswer,
  };
}
