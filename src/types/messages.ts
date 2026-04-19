/**
 * Plugin SDK option types and host→plugin / plugin→host message shapes.
 */

import type {
  LastAnswerObject,
  MediaObject,
  OQSEItem,
  ProgressRecord,
} from '@memizy/oqse';

export type Confidence = NonNullable<LastAnswerObject['confidence']>;
export type Bucket = ProgressRecord['bucket'];
export type ProgressStats = import('@memizy/oqse').StatsObject;
export type ProgressLastAnswer = LastAnswerObject;
export type OQSEPMeta = import('@memizy/oqse').ProgressMeta;
export type OQSEPDocument = import('@memizy/oqse').OQSEPFile;

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
  assets: Record<string, MediaObject>;
  settings: SessionSettings;
  progress?: Record<string, ProgressRecord>;
}

export type OQSETextToken =
  | { type: 'text'; value: string }
  | { type: 'blank'; key: string }
  | { type: 'asset'; key: string; media?: MediaObject };

// ---------------------------------------------------------------------------
// Consumer-facing option types
// ---------------------------------------------------------------------------

export interface AnswerOptions {
  answer?: string;
  confidence?: Confidence;
  /**
   * Time spent in milliseconds. If omitted and `startItemTimer(itemId)` was
   * called, the elapsed time is inferred automatically.
   */
  timeSpent?: number;
  /** Number of hints the user used before submitting (default: 0). */
  hintsUsed?: number;
}

export interface ExitOptions {
  /** Plugin's own internal score (0–100). */
  score?: number | null;
}

export interface MemizyPluginOptions {
  /**
   * Unique identifier for the plugin. MUST match the `id` field in the OQSE
   * Application Manifest. Should be a controlled URL or URN-format UUID.
   */
  id: string;
  /** SemVer version of this plugin (e.g., `"1.0.0"`). */
  version: string;
  /**
   * Milliseconds to wait for `INIT_SESSION` before entering standalone mode.
   * Defaults to `2000`.
   */
  standaloneTimeout?: number;
  /**
   * Log lifecycle events to the browser console for debugging.
   * Defaults to `false`.
   */
  debug?: boolean;
  /**
   * Show the floating ⚙ gear icon in standalone mode.
   * Defaults to `true`. Set to `false` to suppress the built-in UI entirely.
   */
  showStandaloneControls?: boolean;
  /**
   * Corner where the floating ⚙ gear button is anchored in standalone mode.
   * Defaults to `'bottom-right'`.
   */
  standaloneUiPosition?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
}

// ---------------------------------------------------------------------------
// Internal message envelope (host → plugin)
// ---------------------------------------------------------------------------

export interface HostMessage<T extends string, P = undefined> {
  type: T;
  payload?: P;
}

export type IncomingMessage =
  | HostMessage<'INIT_SESSION', InitSessionPayload>
  | HostMessage<'CONFIG_UPDATE', Partial<Pick<SessionSettings, 'theme' | 'locale'>>>
  | HostMessage<'ASSET_STORED', { requestId: string; mediaObject?: MediaObject; error?: string }>
  | HostMessage<'RAW_ASSET_PROVIDED', { requestId: string; file?: File; error?: string }>;
