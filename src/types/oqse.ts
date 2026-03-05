/**
 * OQSE (Open Quiz & Study Exchange) core types.
 * These represent the study-set data model delivered to plugins.
 */

import type { ProgressRecord } from './oqsep';

/** Minimal OQSE item shape exposed to plugins. */
export interface OQSEItem {
  id: string;
  type: string;
  [key: string]: unknown;
}

/**
 * Study-set metadata block, used by `updateMeta()` / `MUTATE_META`.
 */
export interface OQSEMeta {
  /** UUID of the study set. */
  id?: string;
  /** Display title. */
  title?: string;
  /** Short description shown in the library. */
  description?: string;
  /** Searchable tags. */
  tags?: string[];
  /** Set-level shared assets keyed by logical name. */
  assets?: Record<string, MediaObject>;
  [key: string]: unknown;
}

/**
 * Standardized OQSE media object (image, audio, video, or 3-D model).
 *
 * In standalone mode the SDK resolves relative `value` paths to absolute URLs
 * before delivering the payload to the plugin.
 */
export interface MediaObject {
  type: 'image' | 'audio' | 'video' | 'model';
  /** Absolute URL or relative path within an OQSE container. */
  value: string;
  mimeType?: string;
  altText?: string;
  caption?: string;
  width?: number;
  height?: number;
  [key: string]: unknown;
}

export interface SessionFuelState {
  balance: number;
  multiplier: number;
}

export interface SessionSettings {
  shuffle: boolean;
  masteryMode: boolean;
  maxItems: number | null;
  locale: string;
  theme: 'light' | 'dark' | 'system';
  fuel: SessionFuelState;
}

export interface InitSessionPayload {
  sessionId: string;
  items: OQSEItem[];
  settings: SessionSettings;
  /**
   * Set-level shared assets from `meta.assets`.
   * Relative `value` paths are resolved to absolute URLs in standalone mode.
   */
  assets: Record<string, MediaObject>;
  /**
   * Per-item learning progress, keyed by item UUID.
   * Present when progress data was loaded or supplied by the host.
   */
  progress?: Record<string, ProgressRecord>;
}
