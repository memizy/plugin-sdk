/**
 * Pure Leitner spaced-repetition reducer.
 *
 * Takes the previous `ProgressRecord` (or `undefined` for a brand-new item)
 * and returns a fresh record. No side effects, safe to call from anywhere.
 *
 * Ported from v0.2.1 (`old_src/core/leitner.ts`) with no behavioural changes.
 */

import type {
  LastAnswerObject,
  ProgressRecord,
  StatsObject,
} from '@memizy/oqse';
import type { AnswerOptions, Bucket } from '../rpc/types';

/** Days until the next review for each bucket after a correct answer. */
export const LEITNER_INTERVALS_DAYS: Record<Bucket, number> = {
  0: 0,
  1: 1,
  2: 3,
  3: 7,
  4: 30,
};

const MS_PER_DAY = 86_400_000;

/**
 * Applies the Leitner algorithm.
 *
 * Rules:
 *  - **Correct** — bucket + 1 (capped at 4). A new item (bucket 0) jumps
 *    directly to bucket 2 on its first correct answer. Streak increments.
 *  - **Incorrect** — bucket resets to 1. Streak resets to 0.
 *  - `nextReviewAt` is set to `now + LEITNER_INTERVALS_DAYS[newBucket]`.
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
  const newBucket: Bucket = isCorrect
    ? (Math.min(oldBucket < 1 ? 2 : oldBucket + 1, 4) as Bucket)
    : 1;

  const nextReviewAt = new Date(
    Date.now() + LEITNER_INTERVALS_DAYS[newBucket] * MS_PER_DAY,
  ).toISOString();

  const stats: StatsObject = {
    attempts: base.stats.attempts + 1,
    incorrect: base.stats.incorrect + (isCorrect ? 0 : 1),
    streak: isCorrect ? base.stats.streak + 1 : 0,
  };

  const lastAnswer: LastAnswerObject = {
    isCorrect,
    answeredAt: new Date().toISOString(),
    timeSpent,
    confidence: options.confidence,
    hintsUsed: options.hintsUsed ?? 0,
  };

  return { ...base, bucket: newBucket, nextReviewAt, stats, lastAnswer };
}
