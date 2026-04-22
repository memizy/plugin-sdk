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
export type OQSEPDocument = import('@memizy/oqse').OQSEProgress;

export interface SessionSettings {
  locale: string;
  theme: 'light' | 'dark' | 'system';
}

export interface InitSessionPayload {
  sessionId: string;
  items: OQSEItem[];
  assets: Record<string, MediaObject>;
  setMeta?: import('@memizy/oqse').OQSEMeta;
  settings: SessionSettings;
  progress?: Record<string, ProgressRecord>;
}

export type OQSETextToken =
  | { type: 'text'; value: string }
  | { type: 'blank'; key: string }
  | { type: 'asset'; key: string; media?: MediaObject };

export type SessionAbortedReason = 'user_exit' | 'timeout' | 'host_error';
export type StandaloneControlsMode = 'auto' | 'hidden';

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
    * Controls how standalone UI controls are exposed.
    * - `auto`: show floating gear and auto-open when needed.
    * - `hidden`: do not show floating gear; plugin decides when to open via `openStandaloneControls()`.
    * Defaults to `auto`.
    */
    standaloneControlsMode?: StandaloneControlsMode;
    /**
   * Show the floating ⚙ gear icon in standalone mode.
    * Backward-compatible alias for `standaloneControlsMode`.
    * - `true` => `auto`
    * - `false` => `hidden`
    * Defaults to `true`.
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
  | HostMessage<'SESSION_ABORTED', { reason: SessionAbortedReason }>
  | HostMessage<'CONFIG_UPDATE', Partial<Pick<SessionSettings, 'theme' | 'locale'>>>
  | HostMessage<'ASSET_STORED', { requestId: string; mediaObject?: MediaObject; error?: string }>
  | HostMessage<'RAW_ASSET_PROVIDED', { requestId: string; file?: File; error?: string }>;
