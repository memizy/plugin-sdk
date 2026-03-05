/**
 * OQSEP (Open Quiz & Study Exchange — Progress, §2.5) types.
 */

/**
 * OQSEP 4-point confidence scale.
 * 1 = Complete Blackout, 2 = Familiar but Forgotten,
 * 3 = Correct with Effort, 4 = Effortless Recall.
 */
export type Confidence = 1 | 2 | 3 | 4;

/** Leitner knowledge-level bucket (0 = new/reset → 4 = mastered). */
export type Bucket = 0 | 1 | 2 | 3 | 4;

/** Aggregate outcome statistics across all past attempts for an item. */
export interface ProgressStats {
  /** Total number of times this item has been answered. MUST be >= 0. */
  attempts: number;
  /** Total incorrect answers. MUST be <= `attempts`. */
  incorrect: number;
  /** Consecutive correct-answer streak (resets to 0 on any incorrect). */
  streak: number;
}

/** Details of the most recent interaction with an item. */
export interface ProgressLastAnswer {
  isCorrect: boolean;
  /** ISO 8601 timestamp of when the answer was submitted. */
  answeredAt: string;
  confidence?: Confidence;
  /** Time spent on this item in milliseconds. */
  timeSpent?: number;
  /** Number of hints used before answering (default 0). */
  hintsUsed?: number;
  /** `true` if the user skipped the item without answering. */
  isSkipped?: boolean;
}

/**
 * Per-item learning progress record (OQSEP §2.5).
 * Uses a Leitner-inspired 0–4 bucket scale.
 */
export interface ProgressRecord {
  /**
   * 0 = new/reset, 1 = learning, 2 = familiar,
   * 3 = consolidated, 4 = mastered.
   */
  bucket: Bucket;
  /** ISO 8601 timestamp for the next scheduled review. */
  nextReviewAt?: string;
  stats: ProgressStats;
  lastAnswer?: ProgressLastAnswer;
  /**
   * Namespaced algorithm-specific data.
   * Keys MUST be application identifiers
   * (e.g., `{ "memizy": { "fsrs": { "stability": 0.42 } } }`).
   */
  appSpecific?: Record<string, Record<string, unknown>>;
}

/** Metadata block of an OQSEP progress file. */
export interface OQSEPMeta {
  setId: string;
  exportedAt: string;
  algorithm?: string;
}

/** Root structure of an OQSEP document. */
export interface OQSEPDocument {
  $schema?: string;
  version: string;
  meta: OQSEPMeta;
  records: Record<string, ProgressRecord>;
}
