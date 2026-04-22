/**
 * RPC contract between the Memizy Host (Vue player) and the Plugin iframe.
 *
 * All types related to OQSE data models are imported from `@memizy/oqse`
 * and MUST be validated on the host side using the schemas exported there.
 *
 * Two flat namespaced APIs are defined:
 *   - `HostApi`   : methods the Host exposes to the Plugin  (Plugin -> Host)
 *   - `PluginApi` : methods the Plugin exposes to the Host  (Host   -> Plugin)
 */

import type {
  LastAnswerObject,
  MediaObject,
  OQSEItem,
  OQSEMeta,
  ProgressRecord,
} from '@memizy/oqse';

// ---------------------------------------------------------------------------
// Shared session / message payloads
// ---------------------------------------------------------------------------

/** User's confidence level for an answer (1 = low, 4 = high). */
export type Confidence = NonNullable<LastAnswerObject['confidence']>;

/** Leitner bucket (0 = new, 1..4 = review tiers). */
export type Bucket = ProgressRecord['bucket'];

/** Rich-text parse result, asset-resolved when a session is active. */
export type OQSETextToken =
  | { type: 'text'; value: string }
  | { type: 'blank'; key: string }
  | { type: 'asset'; key: string; media?: MediaObject };

/** Host-provided session settings. */
export interface SessionSettings {
  locale: string;
  theme: 'light' | 'dark' | 'system';
}

/** Initial payload returned by `HostApi.sysInit()`. */
export interface InitSessionPayload {
  sessionId: string;
  items: OQSEItem[];
  assets: Record<string, MediaObject>;
  setMeta?: OQSEMeta;
  settings: SessionSettings;
  progress?: Record<string, ProgressRecord>;
}

/** Why a session was terminated from the outside. */
export type SessionAbortedReason = 'user_exit' | 'timeout' | 'host_error';

/** Config delta the host may push mid-session. */
export type ConfigUpdate = Partial<Pick<SessionSettings, 'theme' | 'locale'>>;

// ---------------------------------------------------------------------------
// Plugin-side option shapes (arguments to SDK methods)
// ---------------------------------------------------------------------------

export interface AnswerOptions {
  answer?: string;
  confidence?: Confidence;
  /** Time spent (ms). Auto-inferred from timers when omitted. */
  timeSpent?: number;
  /** Number of hints used before submitting (default 0). */
  hintsUsed?: number;
}

export interface ExitOptions {
  /** Plugin's own internal score (0..100). */
  score?: number | null;
  /** Total session time in ms (filled in by the SDK). */
  totalTimeSpent?: number;
}

export interface ResizeRequest {
  height: number | 'auto';
  width?: number | 'auto' | null;
}

export interface PluginErrorReport {
  code: string;
  message: string;
  itemId?: string | null;
  context?: Record<string, unknown> | null;
}

export interface AssetUploadRequest {
  /** Raw file payload. Transferred via structured clone. */
  file: File | Blob;
  /** Host-addressable key the plugin would like to use. */
  suggestedKey?: string;
}

// ---------------------------------------------------------------------------
// JSON patches (produced by mutative, enablePatches: true)
// ---------------------------------------------------------------------------

/**
 * A single JSON patch operation, structurally compatible with mutative's
 * default (`pathAsArray: true`, `arrayLengthAssignment: true`) output.
 *
 * We intentionally redeclare it here (rather than re-exporting mutative's
 * type) so that the Host side does NOT need `mutative` as a dependency
 * to typecheck the RPC contract.
 */
export interface JsonPatch {
  op: 'add' | 'remove' | 'replace';
  path: (string | number)[];
  value?: unknown;
}

export type JsonPatches = JsonPatch[];

// ---------------------------------------------------------------------------
// Plugin identity (passed to SDK constructor, surfaced to the host)
// ---------------------------------------------------------------------------

export interface PluginIdentity {
  id: string;
  version: string;
}

// ---------------------------------------------------------------------------
// HostApi — methods the HOST exposes to the PLUGIN
// (Plugin calls these through the Penpal `RemoteProxy<HostApi>`.)
// ---------------------------------------------------------------------------

export interface HostApi {
  // System ----------------------------------------------------------------
  /** Plugin requests the initial session data. Called once after handshake. */
  sysInit(identity: PluginIdentity): Promise<InitSessionPayload>;
  /** Plugin signals it has finished (optionally with a score). */
  sysExit(options: ExitOptions): Promise<void>;
  /** Plugin asks the host to resize the iframe container. */
  sysRequestResize(request: ResizeRequest): Promise<void>;
  /** Plugin reports a non-fatal error for host-side telemetry. */
  sysReportError(error: PluginErrorReport): Promise<void>;

  // Store -----------------------------------------------------------------
  /** Push a bag of progress records to the host's persistent store. */
  storeSyncProgress(records: Record<string, ProgressRecord>): Promise<void>;
  /** Apply a JSON patch set to the host's `items` collection. */
  storeApplyItemPatches(patches: JsonPatches): Promise<void>;
  /** Apply a JSON patch set to the host's study-set meta. */
  storeApplyMetaPatches(patches: JsonPatches): Promise<void>;

  // Assets ----------------------------------------------------------------
  /** Upload a File/Blob into the host's asset store, returns a MediaObject. */
  assetUpload(request: AssetUploadRequest): Promise<MediaObject>;
  /** Fetch raw binary data for an asset by key. */
  assetGetRaw(key: string): Promise<File | Blob>;
}

// ---------------------------------------------------------------------------
// PluginApi — methods the PLUGIN exposes to the HOST
// (Host calls these through its `RemoteProxy<PluginApi>`.)
// ---------------------------------------------------------------------------

export interface PluginApi {
  /** Host notifies the plugin that theme/locale changed mid-session. */
  onConfigUpdate(config: ConfigUpdate): Promise<void>;
  /** Host notifies the plugin that the session was externally terminated. */
  onSessionAborted(reason: SessionAbortedReason): Promise<void>;
}
