/**
 * memizy-plugin-sdk
 *
 * Official TypeScript SDK for building Memizy plugins.
 * Implements the State-Sync, CRUD & Asset Bridge architecture.
 * Handles the Leitner spaced-repetition algorithm internally and acts as
 * a bridge to the host's OPFS (Origin Private File System) to bypass
 * iframe CORS limitations.
 *
 * @version 0.2.0
 * @license MIT
 */

// ---------------------------------------------------------------------------
// Type definitions (mirrors plugin-api-v1.md §Message Protocol)
// ---------------------------------------------------------------------------

/** Minimal OQSE item shape exposed to plugins. Full types live in oqse.ts. */
export interface OQSEItem {
  id: string;
  type: string;
  [key: string]: unknown;
}

/**
 * Study-set metadata block.
 * Used by `updateMeta()` to write changes back to the host via `MUTATE_META`.
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
  /** Any additional OQSE meta fields. */
  [key: string]: unknown;
}

/**
 * Standardized OQSE media object. Represents an image, audio, video, or 3D
 * model asset referenced from Rich Content fields or custom item properties.
 *
 * In standalone mode the SDK resolves relative `value` paths to absolute URLs
 * before delivering the payload to the plugin.
 */
export interface MediaObject {
  /** Media type. */
  type: 'image' | 'audio' | 'video' | 'model';
  /** URI of the resource — absolute URL or relative path within an OQSE container. */
  value: string;
  /** MIME type (e.g., `"image/png"`, `"model/gltf-binary"`). */
  mimeType?: string;
  /** Alternative text for accessibility (REQUIRED for images). */
  altText?: string;
  /** Caption displayed alongside the media. */
  caption?: string;
  /** Preferred width in pixels (rendering hint). */
  width?: number;
  /** Preferred height in pixels (rendering hint). */
  height?: number;
  /** Additional properties from the OQSE spec or extensions. */
  [key: string]: unknown;
}

export interface SessionFuelState {
  /** Current Fuel balance of the user before this session. */
  balance: number;
  /** Active streak multiplier (e.g., 1.5). */
  multiplier: number;
}

export interface SessionSettings {
  shuffle: boolean;
  masteryMode: boolean;
  /** Maximum number of items to serve. `null` = serve all. */
  maxItems: number | null;
  /** BCP 47 locale of the host UI (e.g., "en", "cs"). */
  locale: string;
  theme: 'light' | 'dark' | 'system';
  fuel: SessionFuelState;
}

export interface InitSessionPayload {
  sessionId: string;
  items: OQSEItem[];
  settings: SessionSettings;
  /**
   * Set-level shared assets from `meta.assets`. Plugins SHOULD look up asset
   * keys here when they are not found in `item.assets` (OQSE fallback rule).
   *
   * In standalone mode the SDK resolves all relative `value` paths to absolute
   * URLs automatically.
   */
  assets: Record<string, MediaObject>;
  /**
   * Per-item learning progress from an OQSEP file, keyed by item UUID.
   * Present only when progress data was loaded (standalone mode) or supplied
   * by the host. The SDK internalises this on `INIT_SESSION` and keeps it
   * up-to-date as answers are recorded.
   */
  progress?: Record<string, ProgressRecord>;
}

// ---------------------------------------------------------------------------
// OQSEP types (Open Quiz & Study Exchange — Progress, §2.5)
// ---------------------------------------------------------------------------

/**
 * Confidence rating as defined by OQSEP (4-point forced scale).
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
  /** Total count of incorrect answers. MUST be >= 0 and <= `attempts`. */
  incorrect: number;
  /** Current consecutive correct-answer streak (reset to 0 on any incorrect). */
  streak: number;
}

/** Details of the most recent interaction with an item. */
export interface ProgressLastAnswer {
  /** Whether the most recent answer was correct. */
  isCorrect: boolean;
  /** ISO 8601 timestamp of when the answer was submitted. */
  answeredAt: string;
  /** User's self-assessed confidence rating (optional). */
  confidence?: Confidence;
  /** Time spent on this item in milliseconds (optional). */
  timeSpent?: number;
  /** Number of hints used before answering (optional, default 0). */
  hintsUsed?: number;
  /** If `true`, the user skipped the item without answering. */
  isSkipped?: boolean;
}

/**
 * Per-item learning progress record (OQSEP §2.5).
 * Uses a Leitner-inspired 0–4 bucket scale.
 */
export interface ProgressRecord {
  /**
   * Current knowledge level.
   * 0 = new/reset, 1 = learning, 2 = familiar, 3 = consolidated, 4 = mastered.
   */
  bucket: Bucket;
  /** ISO 8601 timestamp for the next scheduled review. */
  nextReviewAt?: string;
  /** Aggregate outcome statistics across all past attempts. */
  stats: ProgressStats;
  /** Details of the most recent interaction. */
  lastAnswer?: ProgressLastAnswer;
  /**
   * Namespaced algorithm-specific data. Top-level keys MUST be application
   * identifiers (e.g., `{ "memizy": { "fsrs": { "stability": 0.42 } } }`).
   */
  appSpecific?: Record<string, Record<string, unknown>>;
}

/** Metadata block of an OQSEP progress file. */
export interface OQSEPMeta {
  /** UUID of the OQSE study set this progress corresponds to. */
  setId: string;
  /** ISO 8601 timestamp of when this file was generated. */
  exportedAt: string;
  /**
   * Identifier of the spaced repetition algorithm (e.g., "leitner", "sm2", "fsrs").
   * Informational only — importers MUST NOT refuse files with a different algorithm.
   */
  algorithm?: string;
}

/**
 * Root structure of an OQSEP (progress) document.
 * Always a separate JSON file associated with a specific OQSE study set.
 */
export interface OQSEPDocument {
  $schema?: string;
  /** OQSEP format version (e.g., "0.1"). */
  version: string;
  /** Metadata describing the origin of this progress data. */
  meta: OQSEPMeta;
  /** Map of item UUIDs to their progress records. */
  records: Record<string, ProgressRecord>;
}

// ---------------------------------------------------------------------------
// Answer / completion options
// ---------------------------------------------------------------------------

export interface AnswerOptions {
  /** Raw string answer (what the user typed/selected). */
  answer?: string;
  /** User self-reported confidence (OQSEP 4-point scale). */
  confidence?: Confidence;
  /**
   * Time spent in milliseconds. If omitted and `startItemTimer(itemId)` was
   * called, the elapsed time is inferred automatically.
   */
  timeSpent?: number;
  /** Number of hints the user used before submitting this answer (default: 0). */
  hintsUsed?: number;
}

export interface ExitOptions {
  /** Plugin's own internal score (0–100). Host calculates its own in parallel. */
  score?: number | null;
}

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

export interface MemizyPluginOptions {
  /**
   * Unique identifier for the plugin. MUST match the `id` field in the plugin's
   * OQSE Application Manifest. Should be a controlled URL (e.g.,
   * `"https://my-domain.com/my-plugin"`) or a URN-format UUID
   * (e.g., `"urn:uuid:019aa600-abc1-7234-b678-c0ffee000001"`).
   */
  id: string;
  /** SemVer version of this plugin (e.g., `"1.0.0"`). */
  version: string;
  /**
   * Milliseconds to wait for INIT_SESSION before triggering standalone/mock
   * mode. Defaults to 2000.
   */
  standaloneTimeout?: number;
  /**
   * When `true`, the SDK logs lifecycle events (standalone detection, OQSE
   * fetch, payload summary, asset resolution, Leitner transitions) to the
   * browser console. Leave disabled in production.
   * Defaults to `false`.
   */
  debug?: boolean;
  /**
   * Show a floating ⚙ settings button in standalone mode. The button is only
   * shown when the plugin runs outside a host iframe.
   * Defaults to `true`. Set to `false` to suppress the built-in UI entirely.
   */
  showStandaloneControls?: boolean;
}

// ---------------------------------------------------------------------------
// Internal message envelopes
// ---------------------------------------------------------------------------

interface HostMessage<T extends string, P = undefined> {
  type: T;
  payload?: P;
}

type IncomingMessage =
  | HostMessage<'INIT_SESSION', InitSessionPayload>
  | HostMessage<'CONFIG_UPDATE', Partial<Pick<SessionSettings, 'theme' | 'locale'>>>
  | HostMessage<'ASSET_STORED', { requestId: string; mediaObject?: MediaObject; error?: string }>
  | HostMessage<'RAW_ASSET_PROVIDED', { requestId: string; file?: File; error?: string }>;

// ---------------------------------------------------------------------------
// Shadow DOM standalone UI — matches Memizy brand (orange primary)
// ---------------------------------------------------------------------------

const STANDALONE_UI_CSS = `
:host {
  all: initial;
  display: contents;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #1f2937;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
*, *::before, *::after { box-sizing: border-box; }

/* ── Gear button ── */
.gear-btn {
  position: fixed;
  bottom: 16px;
  right: 16px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: #fff;
  border: 1px solid #e5e7eb;
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  opacity: 0.5;
  transition: opacity 0.2s, box-shadow 0.2s, transform 0.2s;
  z-index: 2147483646;
  color: #ff6b00;
  padding: 0;
  margin: 0;
}
.gear-btn:hover {
  opacity: 1;
  box-shadow: 0 4px 16px rgba(0,0,0,0.18);
  transform: rotate(30deg);
}

/* ── Modal overlay ── */
.overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.45);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}
.overlay.hidden { display: none; }

/* ── Card ── */
.card {
  background: #fff;
  border-radius: 16px;
  width: min(520px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0,0,0,0.25);
  color: #1f2937;
}

/* ── Header ── */
.header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 24px 0;
}
.header .logo { font-size: 1.5rem; line-height: 1; }
.header h2 {
  flex: 1;
  margin: 0;
  font-size: 1.1rem;
  font-weight: 700;
  color: #1f2937;
}
.header h2 span { color: #9ca3af; font-weight: 400; }
.close-btn {
  background: none;
  border: none;
  font: inherit;
  font-size: 1.4rem;
  color: #9ca3af;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
  line-height: 1;
  transition: color 0.15s, background 0.15s;
}
.close-btn:hover { color: #1f2937; background: #f3f4f6; }

/* ── Tabs ── */
.tabs {
  display: flex;
  border-bottom: 1px solid #e5e7eb;
  padding: 0 24px;
  margin-top: 16px;
  gap: 0;
}
.tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  font: inherit;
  padding: 10px 16px;
  font-size: 0.88rem;
  font-weight: 500;
  color: #6b7280;
  cursor: pointer;
  margin-bottom: -1px;
  transition: color 0.15s, border-color 0.15s;
}
.tab:hover { color: #1f2937; }
.tab.active { color: #ff6b00; border-bottom-color: #ff6b00; font-weight: 600; }

/* ── Tab body ── */
.tab-body { padding: 20px 24px 24px; }
.tab-body.hidden { display: none; }

/* ── Section / label ── */
.section { margin-bottom: 14px; }
.section:last-child { margin-bottom: 0; }
label {
  display: block;
  font-size: 0.82rem;
  font-weight: 600;
  color: #374151;
  margin-bottom: 6px;
}

/* ── Inputs ── */
input[type="url"], input[type="text"] {
  width: 100%;
  padding: 10px 12px;
  background: #f9fafb;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  color: #1f2937;
  font: inherit;
  font-size: 0.9rem;
  outline: none;
  min-width: 0;
  transition: border-color 0.15s;
}
input:focus { border-color: #ff6b00; }
input::placeholder { color: #9ca3af; }
textarea {
  display: block;
  width: 100%;
  padding: 10px 12px;
  background: #f9fafb;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  color: #1f2937;
  font-family: 'SF Mono', 'Cascadia Code', Consolas, monospace;
  font-size: 0.82rem;
  outline: none;
  resize: vertical;
  min-height: 76px;
  transition: border-color 0.15s;
}
textarea:focus { border-color: #ff6b00; }
textarea::placeholder { color: #9ca3af; }

/* ── Buttons ── */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  min-width: 44px;
  min-height: 40px;
  transition: background 0.15s, opacity 0.15s;
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary { background: #ff6b00; color: #fff; }
.btn-primary:hover:not(:disabled) { background: #e65c00; }
.btn-secondary { background: #f3f4f6; color: #374151; }
.btn-secondary:hover:not(:disabled) { background: #e5e7eb; }
.btn-sm { padding: 7px 14px; font-size: 0.84rem; min-height: 34px; }
.btn-full { width: 100%; }

/* ── Row ── */
.row { display: flex; gap: 8px; align-items: stretch; }
.row input[type="url"] { flex: 1; }

/* ── Divider ── */
.divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 14px 0;
  color: #9ca3af;
  font-size: 0.78rem;
}
.divider::before, .divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #e5e7eb;
}

/* ── Drop zone ── */
.drop-zone {
  border: 2px dashed #d1d5db;
  border-radius: 10px;
  padding: 18px;
  text-align: center;
  cursor: pointer;
  color: #6b7280;
  font-size: 0.85rem;
  transition: border-color 0.15s, background 0.15s;
  line-height: 1.5;
}
.drop-zone:hover, .drop-zone.drag-over {
  border-color: #ff6b00;
  background: #fff7ed;
}
.drop-zone .dz-icon { font-size: 1.3rem; margin-bottom: 4px; display: block; }

/* ── Status ── */
.status-bar {
  padding: 0 24px 4px;
  min-height: 1.3em;
  font-size: 0.83rem;
}
.status-bar.s-error { color: #ef4444; }
.status-bar.s-ok { color: #10b981; }
.status-bar.s-info { color: #6b7280; }

/* ── Hint ── */
.hint {
  padding: 6px 24px 18px;
  font-size: 0.76rem;
  color: #9ca3af;
  text-align: center;
}
code {
  background: #f3f4f6;
  padding: 1px 5px;
  border-radius: 4px;
  font-family: 'SF Mono', 'Cascadia Code', Consolas, monospace;
  font-size: 0.82em;
}

/* ── Progress loaded indicator ── */
.progress-ok {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 0.85rem;
  color: #166534;
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}
`;

// ---------------------------------------------------------------------------
// Leitner interval table (days per bucket after a correct answer)
// ---------------------------------------------------------------------------

const LEITNER_INTERVALS_DAYS: Record<Bucket, number> = {
  0: 0,  // "new" — shouldn't normally be set as a target
  1: 1,
  2: 3,
  3: 7,
  4: 30,
};

// ---------------------------------------------------------------------------
// MemizyPlugin
// ---------------------------------------------------------------------------

/**
 * Main SDK class. Instantiate once per plugin page load.
 *
 * **Architecture: State-Sync, CRUD & Asset Bridge**
 *
 * - Maintains an internal `progressRecords` store updated by every `answer()` /
 *   `skip()` call via the built-in Leitner reducer.
 * - Sends `SYNC_PROGRESS` to the host after every state mutation so the host's
 *   OPFS copy stays in sync.
 * - Exposes CRUD helpers (`saveItems`, `deleteItems`, `updateMeta`) that map to
 *   typed postMessage calls handled by the host.
 * - Exposes `uploadAsset` / `getRawAsset` as Promise-based wrappers around the
 *   `STORE_ASSET` / `REQUEST_RAW_ASSET` bridge, letting plugins read/write OPFS
 *   assets through the host despite iframe CORS restrictions.
 *
 * **Standalone mode** is handled automatically via a floating ⚙ gear button.
 *
 * @example
 * ```typescript
 * const plugin = new MemizyPlugin({ id: 'https://my-domain.com/my-quiz', version: '1.0.0' });
 * plugin.onInit(({ items, assets, progress }) => render(items, progress));
 * ```
 */
export class MemizyPlugin {
  private readonly id: string;
  private readonly version: string;
  private readonly standaloneTimeout: number;
  private readonly debugMode: boolean;
  private readonly showStandaloneControls: boolean;

  // Registered callbacks
  private initHandler: ((payload: InitSessionPayload) => void) | null = null;
  private configUpdateHandler: ((config: Partial<Pick<SessionSettings, 'theme' | 'locale'>>) => void) | null = null;

  // Item timers: itemId → start timestamp (ms)
  private readonly itemTimers = new Map<string, number>();

  // Session-level stopwatch
  private sessionStartTime: number = Date.now();

  // Internal progress state — the source of truth for SYNC_PROGRESS
  private progressRecords: Record<string, ProgressRecord> = {};

  // Mock data for standalone / dev mode
  private mockItems: OQSEItem[] | null = null;
  private mockSettings: Partial<SessionSettings> | null = null;
  private mockAssets: Record<string, MediaObject> | null = null;
  private standaloneTimer: ReturnType<typeof setTimeout> | null = null;

  // Progress data loaded in standalone mode (before a session starts)
  private standaloneProgress: Record<string, ProgressRecord> | null = null;

  // Whether INIT_SESSION (or standalone equivalent) has been received
  private initialized = false;

  // Shadow DOM host element (gear + dialog)
  private standaloneUiHost: HTMLElement | null = null;
  private standaloneOverlay: HTMLElement | null = null;

  // Asset bridge: pending promise resolvers keyed by requestId
  private readonly pendingAssetRequests = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
  >();

  // Message listener reference for clean removal
  private readonly messageListener: (event: MessageEvent) => void;

  constructor(options: MemizyPluginOptions) {
    this.id = options.id;
    this.version = options.version;
    this.standaloneTimeout = options.standaloneTimeout ?? 2000;
    this.debugMode = options.debug ?? false;
    this.showStandaloneControls = options.showStandaloneControls ?? true;

    this.messageListener = this.handleMessage.bind(this);
    window.addEventListener('message', this.messageListener);

    this.send('PLUGIN_READY', { id: this.id, version: this.version });
    this.log(`SDK v0.3.0 loaded — id=${this.id}, standalone=${window.self === window.top}`);

    queueMicrotask(() => this.maybeInitStandaloneMode());
  }

  // -------------------------------------------------------------------------
  // Private: postMessage helpers
  // -------------------------------------------------------------------------

  private send<T extends string, P>(type: T, payload?: P): void {
    const message = payload !== undefined ? { type, payload } : { type };
    window.parent.postMessage(message, '*');
  }

  private log(...args: unknown[]): void {
    if (this.debugMode) console.log('[memizy-plugin-sdk]', ...args);
  }

  private handleMessage(event: MessageEvent): void {
    if (event.source !== window.parent) return;
    const msg = event.data as IncomingMessage;
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'INIT_SESSION': {
        const payload = msg.payload as InitSessionPayload;
        this.initialized = true;
        this.removeStandaloneUi();
        if (this.standaloneTimer !== null) {
          clearTimeout(this.standaloneTimer);
          this.standaloneTimer = null;
        }
        // Internalise incoming progress so subsequent answer() calls can update it
        if (payload.progress) {
          this.progressRecords = { ...payload.progress };
        }
        this.sessionStartTime = Date.now();
        this.log('INIT_SESSION received from host, items:', payload.items.length);
        this.initHandler?.(payload);
        break;
      }

      case 'CONFIG_UPDATE': {
        this.configUpdateHandler?.(
          msg.payload as Partial<Pick<SessionSettings, 'theme' | 'locale'>>
        );
        break;
      }

      case 'ASSET_STORED': {
        const { requestId, mediaObject, error } =
          msg.payload as { requestId: string; mediaObject?: MediaObject; error?: string };
        const pending = this.pendingAssetRequests.get(requestId);
        if (pending) {
          this.pendingAssetRequests.delete(requestId);
          if (error || !mediaObject) {
            pending.reject(new Error(error ?? 'ASSET_STORED: no mediaObject returned'));
          } else {
            pending.resolve(mediaObject);
          }
        }
        break;
      }

      case 'RAW_ASSET_PROVIDED': {
        const { requestId, file, error } =
          msg.payload as { requestId: string; file?: File; error?: string };
        const pending = this.pendingAssetRequests.get(requestId);
        if (pending) {
          this.pendingAssetRequests.delete(requestId);
          if (error || !file) {
            pending.reject(new Error(error ?? 'RAW_ASSET_PROVIDED: no file returned'));
          } else {
            pending.resolve(file);
          }
        }
        break;
      }

      default:
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Private: Leitner reducer
  // -------------------------------------------------------------------------

  /**
   * Computes a new `ProgressRecord` by applying the Leitner algorithm to the
   * existing record (or a fresh baseline if none exists yet).
   *
   * Rules:
   * - **Correct:** `bucket` advances by 1 (max 4). Streak increments.
   * - **Incorrect:** `bucket` resets to 1 (regardless of current level). Streak resets to 0.
   * - `nextReviewAt` is set to `now + LEITNER_INTERVALS_DAYS[newBucket]`.
   */
  private defaultLeitnerReducer(
    itemId: string,
    isCorrect: boolean,
    options: AnswerOptions,
    timeSpent: number,
  ): ProgressRecord {
    const existing: ProgressRecord = this.progressRecords[itemId] ?? {
      bucket: 0,
      stats: { attempts: 0, incorrect: 0, streak: 0 },
    };

    const oldBucket = existing.bucket;
    const newBucket: Bucket = isCorrect
      ? (Math.min(oldBucket + 1, 4) as Bucket)
      : 1;

    const intervalDays = LEITNER_INTERVALS_DAYS[newBucket];
    const nextReviewAt = new Date(Date.now() + intervalDays * 86_400_000).toISOString();

    const newStats: ProgressStats = {
      attempts: existing.stats.attempts + 1,
      incorrect: existing.stats.incorrect + (isCorrect ? 0 : 1),
      streak: isCorrect ? existing.stats.streak + 1 : 0,
    };

    const lastAnswer: ProgressLastAnswer = {
      isCorrect,
      answeredAt: new Date().toISOString(),
      timeSpent,
      confidence: options.confidence,
      hintsUsed: options.hintsUsed ?? 0,
    };

    this.log(
      `Leitner [${itemId}]: bucket ${oldBucket} → ${newBucket},`,
      `correct=${isCorrect}, streak=${newStats.streak}, nextReview=${nextReviewAt}`,
    );

    return {
      ...existing,
      bucket: newBucket,
      nextReviewAt,
      stats: newStats,
      lastAnswer,
    };
  }

  // -------------------------------------------------------------------------
  // Private: standalone mode
  // -------------------------------------------------------------------------

  private maybeInitStandaloneMode(): void {
    if (this.initialized) return;
    if (window.self !== window.top) return;

    const params = new URLSearchParams(window.location.search);
    const setUrl = params.get('set');

    if (this.showStandaloneControls) {
      const autoOpen = !setUrl && !this.mockItems;
      this.injectStandaloneUi(autoOpen);
    }

    if (setUrl) {
      this.log('Standalone: ?set= detected, fetching', setUrl);
      void this.fetchOqseAndInit(setUrl);
    } else if (!this.mockItems) {
      this.log('Standalone: no data source, waiting for user input');
    }
  }

  // -------------------------------------------------------------------------
  // Private: OQSE loading / parsing
  // -------------------------------------------------------------------------

  private async fetchOqseAndInit(
    url: string,
    onError?: (msg: string) => void,
  ): Promise<void> {
    let payload: InitSessionPayload;

    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status} — ${resp.statusText}`);
      const oqse = (await resp.json()) as Record<string, unknown>;

      const rawItems = (oqse['items'] as OQSEItem[] | undefined) ?? [];
      if (!Array.isArray(rawItems)) throw new Error('OQSE file is missing an "items" array.');

      const baseUrl = url.replace(/[^/]*$/, '');

      const meta = oqse['meta'] as Record<string, unknown> | undefined;
      const metaAssets = (meta?.['assets'] ?? {}) as Record<string, Record<string, unknown>>;
      MemizyPlugin.resolveAssetValues(metaAssets, baseUrl);

      this.log(`Fetched OQSE: ${rawItems.length} items, meta.assets keys:`, Object.keys(metaAssets));

      for (const item of rawItems) {
        const itemAssets = (item['assets'] ?? {}) as Record<string, Record<string, unknown>>;
        if (typeof itemAssets === 'object' && itemAssets !== null) {
          MemizyPlugin.resolveAssetValues(itemAssets, baseUrl);
        }
      }

      payload = this.buildStandalonePayload(rawItems, metaAssets as Record<string, MediaObject>);
      this.log('Payload built, assets:', Object.keys(payload.assets));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[memizy-plugin-sdk] Standalone fetch failed:', msg);
      onError?.(msg);
      return;
    }

    this.activateSession(payload);
  }

  private initFromOqseText(jsonText: string, onError?: (msg: string) => void): void {
    try {
      const oqse = JSON.parse(jsonText) as Record<string, unknown>;
      const rawItems = (oqse['items'] as OQSEItem[] | undefined) ?? [];
      if (!Array.isArray(rawItems)) throw new Error('Missing "items" array.');

      const meta = oqse['meta'] as Record<string, unknown> | undefined;
      const metaAssets = (meta?.['assets'] ?? {}) as Record<string, Record<string, unknown>>;

      this.log(`Parsed OQSE text: ${rawItems.length} items`);
      const payload = this.buildStandalonePayload(rawItems, metaAssets as Record<string, MediaObject>);
      this.activateSession(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[memizy-plugin-sdk] Failed to parse OQSE text:', msg);
      onError?.(msg);
    }
  }

  private initFromFile(file: File, onError?: (msg: string) => void): void {
    const reader = new FileReader();
    reader.onload = () => this.initFromOqseText(reader.result as string, onError);
    reader.onerror = () => onError?.('Failed to read file.');
    reader.readAsText(file);
  }

  private buildStandalonePayload(
    items: OQSEItem[],
    assets: Record<string, MediaObject>,
  ): InitSessionPayload {
    return {
      sessionId: `standalone-${Date.now()}`,
      items,
      assets,
      settings: {
        shuffle: false,
        masteryMode: false,
        maxItems: null,
        locale: navigator.language.split('-')[0] ?? 'en',
        theme: 'light',
        fuel: { balance: 0, multiplier: 1 },
      },
      progress: this.standaloneProgress ?? undefined,
    };
  }

  private activateSession(payload: InitSessionPayload): void {
    this.initialized = true;
    if (this.standaloneTimer !== null) {
      clearTimeout(this.standaloneTimer);
      this.standaloneTimer = null;
    }
    if (payload.progress) {
      this.progressRecords = { ...payload.progress };
    }
    this.hideStandaloneDialog();
    this.sessionStartTime = Date.now();
    this.log('Calling onInit handler');
    this.initHandler?.(payload);
  }

  // -------------------------------------------------------------------------
  // Private: OQSEP (progress) parsing
  // -------------------------------------------------------------------------

  private parseOqsepText(
    jsonText: string,
  ): { records?: Record<string, ProgressRecord>; error?: string } {
    try {
      const doc = JSON.parse(jsonText) as Record<string, unknown>;
      if (!doc['records'] || typeof doc['records'] !== 'object') {
        return { error: 'Invalid OQSEP: missing "records" object.' };
      }
      if (!doc['meta'] || typeof doc['meta'] !== 'object') {
        return { error: 'Invalid OQSEP: missing "meta" object.' };
      }
      const records = doc['records'] as Record<string, ProgressRecord>;
      this.log(`Parsed OQSEP: ${Object.keys(records).length} records`);
      return { records };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  private loadProgressFile(
    file: File,
    setStatus: (msg: string, type: string) => void,
    updateIndicator: () => void,
  ): void {
    const reader = new FileReader();
    reader.onload = () => {
      const result = this.parseOqsepText(reader.result as string);
      if (result.error) {
        setStatus('\u274c ' + result.error, 's-error');
      } else {
        this.standaloneProgress = result.records!;
        const count = Object.keys(result.records!).length;
        setStatus(
          `\u2713 Progress loaded: ${count} record${count !== 1 ? 's' : ''} (${file.name})`,
          's-ok',
        );
        updateIndicator();
      }
    };
    reader.onerror = () => setStatus('Failed to read file.', 's-error');
    reader.readAsText(file);
  }

  // -------------------------------------------------------------------------
  // Private: asset resolution
  // -------------------------------------------------------------------------

  private static resolveAssetValues(
    assets: Record<string, Record<string, unknown>>,
    baseUrl: string,
  ): void {
    for (const key of Object.keys(assets)) {
      const media = assets[key];
      if (media == null || typeof media !== 'object') continue;
      const value = media['value'];
      if (typeof value !== 'string') continue;
      if (/^[a-z][a-z0-9+\-.]*:/i.test(value)) continue;
      try {
        media['value'] = new URL(value, baseUrl).href;
      } catch {
        // Malformed URL — leave as-is
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private: UUID
  // -------------------------------------------------------------------------

  private static newRequestId(): string {
    // crypto.randomUUID() is available in all modern browsers (including Workers)
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // Minimal fallback for environments without crypto.randomUUID
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  // -------------------------------------------------------------------------
  // Private: standalone UI
  // -------------------------------------------------------------------------

  private injectStandaloneUi(autoOpen: boolean): void {
    if (this.standaloneUiHost) return;

    const host = document.createElement('div');
    host.setAttribute('data-memizy-standalone', '');
    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = STANDALONE_UI_CSS;
    shadow.appendChild(style);

    // ── Gear button ──
    const gearBtn = document.createElement('button');
    gearBtn.className = 'gear-btn';
    gearBtn.textContent = '\u2699';
    gearBtn.title = 'Standalone settings';
    shadow.appendChild(gearBtn);

    // ── Dialog overlay ──
    const overlay = document.createElement('div');
    overlay.className = autoOpen ? 'overlay' : 'overlay hidden';
    overlay.innerHTML = `
      <div class="card">
        <div class="header">
          <span class="logo">\ud83d\ude80</span>
          <h2>Memizy <span>Standalone</span></h2>
          <button class="close-btn" id="close-btn">\u00d7</button>
        </div>
        <div class="tabs">
          <button class="tab active" data-tab="set">Study Set</button>
          <button class="tab" data-tab="progress">Progress</button>
        </div>

        <div class="tab-body" id="tab-set">
          <div class="section">
            <label>Load from URL</label>
            <div class="row">
              <input type="url" id="url-input" placeholder="https://example.com/data.oqse.json" autocomplete="off" spellcheck="false" />
              <button class="btn btn-primary btn-sm" id="url-btn">Load</button>
            </div>
          </div>
          <div class="divider">or</div>
          <div class="section">
            <label>Paste OQSE JSON</label>
            <textarea id="set-json" rows="3" placeholder='{ "items": [ ... ] }'></textarea>
            <button class="btn btn-secondary btn-sm btn-full" id="set-json-btn" style="margin-top:8px">Load from text</button>
          </div>
          <div class="divider">or</div>
          <div class="section">
            <label>Upload file</label>
            <div class="drop-zone" id="set-drop">
              <span class="dz-icon">\ud83d\udcc1</span>
              Drop <code>.oqse.json</code> here or click to browse
              <input type="file" id="set-file" accept=".json,.oqse" hidden />
            </div>
          </div>
        </div>

        <div class="tab-body hidden" id="tab-progress">
          <div id="progress-status"></div>
          <div class="section">
            <label>Paste OQSEP JSON</label>
            <textarea id="progress-json" rows="3" placeholder='{ "version": "0.1", "meta": { ... }, "records": { ... } }'></textarea>
            <button class="btn btn-secondary btn-sm btn-full" id="progress-json-btn" style="margin-top:8px">Load progress</button>
          </div>
          <div class="divider">or</div>
          <div class="section">
            <label>Upload file</label>
            <div class="drop-zone" id="progress-drop">
              <span class="dz-icon">\ud83d\udcc1</span>
              Drop <code>.oqsep</code> file here or click to browse
              <input type="file" id="progress-file" accept=".oqsep,.json" hidden />
            </div>
          </div>
        </div>

        <div class="status-bar" id="status-msg"></div>
        <div class="hint">Tip: append <code>?set=&lt;url&gt;</code> to the page URL to auto-load</div>
      </div>
    `;
    shadow.appendChild(overlay);
    document.body.appendChild(host);

    this.standaloneUiHost = host;
    this.standaloneOverlay = overlay;

    const $ = (id: string) => shadow.getElementById(id);
    const statusEl = $('status-msg')!;
    const setStatus = (msg: string, cls: string) => {
      statusEl.textContent = msg;
      statusEl.className = `status-bar ${cls}`;
    };
    const clearStatus = () => {
      statusEl.textContent = '';
      statusEl.className = 'status-bar';
    };

    const updateProgressIndicator = () => {
      const el = $('progress-status');
      if (!el) return;
      if (this.standaloneProgress) {
        const count = Object.keys(this.standaloneProgress).length;
        el.innerHTML = `<div class="progress-ok">\u2705 ${count} progress record${count !== 1 ? 's' : ''} loaded</div>`;
      } else {
        el.innerHTML = '';
      }
    };

    gearBtn.addEventListener('click', () => overlay.classList.toggle('hidden'));
    $('close-btn')!.addEventListener('click', () => overlay.classList.add('hidden'));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });

    const tabs = shadow.querySelectorAll('.tab') as NodeListOf<HTMLElement>;
    const tabBodies: Record<string, HTMLElement> = {
      set: $('tab-set')!,
      progress: $('tab-progress')!,
    };
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset['tab']!;
        Object.values(tabBodies).forEach(b => b.classList.add('hidden'));
        tabBodies[target]?.classList.remove('hidden');
        clearStatus();
      });
    });

    const urlInput = $('url-input') as HTMLInputElement;
    const urlBtn = $('url-btn') as HTMLButtonElement;
    const loadFromUrl = () => {
      const url = urlInput.value.trim();
      if (!url) { setStatus('Please enter a URL.', 's-error'); return; }
      clearStatus();
      urlBtn.disabled = true;
      urlBtn.textContent = '\u2026';
      void this.fetchOqseAndInit(url, (msg) => {
        setStatus('\u274c ' + msg, 's-error');
        urlBtn.disabled = false;
        urlBtn.textContent = 'Load';
      });
    };
    urlBtn.addEventListener('click', loadFromUrl);
    urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadFromUrl(); });

    const setJsonArea = $('set-json') as HTMLTextAreaElement;
    $('set-json-btn')!.addEventListener('click', () => {
      const text = setJsonArea.value.trim();
      if (!text) { setStatus('Please paste JSON content.', 's-error'); return; }
      clearStatus();
      this.initFromOqseText(text, (msg) => setStatus('\u274c ' + msg, 's-error'));
    });

    const setFileInput = $('set-file') as HTMLInputElement;
    const setDrop = $('set-drop')!;
    setDrop.addEventListener('click', () => setFileInput.click());
    setFileInput.addEventListener('change', () => {
      const file = setFileInput.files?.[0];
      if (file) { clearStatus(); this.initFromFile(file, (msg) => setStatus('\u274c ' + msg, 's-error')); }
    });
    setDrop.addEventListener('dragover', (e) => { e.preventDefault(); setDrop.classList.add('drag-over'); });
    setDrop.addEventListener('dragleave', () => setDrop.classList.remove('drag-over'));
    setDrop.addEventListener('drop', (e) => {
      e.preventDefault();
      setDrop.classList.remove('drag-over');
      const file = (e as DragEvent).dataTransfer?.files[0];
      if (file) { clearStatus(); this.initFromFile(file, (msg) => setStatus('\u274c ' + msg, 's-error')); }
    });

    const progressJsonArea = $('progress-json') as HTMLTextAreaElement;
    $('progress-json-btn')!.addEventListener('click', () => {
      const text = progressJsonArea.value.trim();
      if (!text) { setStatus('Please paste OQSEP JSON.', 's-error'); return; }
      const result = this.parseOqsepText(text);
      if (result.error) {
        setStatus('\u274c ' + result.error, 's-error');
      } else {
        this.standaloneProgress = result.records!;
        const count = Object.keys(result.records!).length;
        setStatus(`\u2713 Progress loaded: ${count} record${count !== 1 ? 's' : ''}`, 's-ok');
        updateProgressIndicator();
      }
    });

    const progressFileInput = $('progress-file') as HTMLInputElement;
    const progressDrop = $('progress-drop')!;
    progressDrop.addEventListener('click', () => progressFileInput.click());
    progressFileInput.addEventListener('change', () => {
      const file = progressFileInput.files?.[0];
      if (file) this.loadProgressFile(file, setStatus, updateProgressIndicator);
    });
    progressDrop.addEventListener('dragover', (e) => { e.preventDefault(); progressDrop.classList.add('drag-over'); });
    progressDrop.addEventListener('dragleave', () => progressDrop.classList.remove('drag-over'));
    progressDrop.addEventListener('drop', (e) => {
      e.preventDefault();
      progressDrop.classList.remove('drag-over');
      const file = (e as DragEvent).dataTransfer?.files[0];
      if (file) this.loadProgressFile(file, setStatus, updateProgressIndicator);
    });

    if (autoOpen) requestAnimationFrame(() => urlInput.focus());
  }

  private hideStandaloneDialog(): void {
    this.standaloneOverlay?.classList.add('hidden');
  }

  private removeStandaloneUi(): void {
    this.standaloneUiHost?.remove();
    this.standaloneUiHost = null;
    this.standaloneOverlay = null;
  }

  // -------------------------------------------------------------------------
  // Private: mock helpers
  // -------------------------------------------------------------------------

  private buildMockPayload(): InitSessionPayload {
    const defaults: SessionSettings = {
      shuffle: false,
      masteryMode: false,
      maxItems: null,
      locale: navigator.language.split('-')[0] ?? 'en',
      theme: 'light',
      fuel: { balance: 0, multiplier: 1 },
      ...this.mockSettings,
    };
    return {
      sessionId: `mock-${Date.now()}`,
      items: this.mockItems ?? [],
      assets: this.mockAssets ?? {},
      settings: defaults,
      progress: this.standaloneProgress ?? undefined,
    };
  }

  private scheduleMockFallback(): void {
    if (this.initialized || this.mockItems === null) return;
    if (this.standaloneTimer !== null) return;

    this.log(`Mock fallback scheduled (${this.standaloneTimeout}ms)`);
    this.standaloneTimer = setTimeout(() => {
      if (!this.initialized) this.triggerMock();
    }, this.standaloneTimeout);
  }

  // -------------------------------------------------------------------------
  // Callback registration
  // -------------------------------------------------------------------------

  /**
   * Register a callback for `INIT_SESSION`.
   * This is the main entry point for plugin startup logic. In standalone mode
   * the SDK fires this callback automatically.
   */
  onInit(handler: (payload: InitSessionPayload) => void): this {
    this.initHandler = handler;
    return this;
  }

  /**
   * Register a callback for `CONFIG_UPDATE`
   * (e.g., the user changed the theme or locale mid-session).
   */
  onConfigUpdate(
    handler: (config: Partial<Pick<SessionSettings, 'theme' | 'locale'>>) => void,
  ): this {
    this.configUpdateHandler = handler;
    return this;
  }

  // -------------------------------------------------------------------------
  // State-Sync: answer & skip
  // -------------------------------------------------------------------------

  /**
   * Record an answer for an item.
   *
   * 1. Stops the item timer (or uses `options.timeSpent`).
   * 2. Runs the Leitner reducer to compute the new `ProgressRecord`.
   * 3. Saves it to the internal state store.
   * 4. Immediately sends `SYNC_PROGRESS` with the updated record.
   *
   * @returns `this` for chaining.
   */
  answer(itemId: string, isCorrect: boolean, options: AnswerOptions = {}): this {
    let timeSpent = options.timeSpent;
    if (timeSpent === undefined) {
      timeSpent = this.itemTimers.has(itemId) ? this.stopItemTimer(itemId) : 0;
    } else if (this.itemTimers.has(itemId)) {
      this.clearItemTimer(itemId);
    }

    const record = this.defaultLeitnerReducer(itemId, isCorrect, options, timeSpent);
    this.progressRecords[itemId] = record;
    this.send('SYNC_PROGRESS', { [itemId]: record } as Record<string, ProgressRecord>);
    return this;
  }

  /**
   * Record that the user skipped an item without answering.
   *
   * The bucket and stats are NOT modified. Only `lastAnswer` is updated
   * (with `isSkipped: true` and the elapsed `timeSpent`).
   * Sends `SYNC_PROGRESS` with the updated record.
   */
  skip(itemId: string): this {
    const timeSpent = this.itemTimers.has(itemId) ? this.stopItemTimer(itemId) : 0;

    const existing: ProgressRecord = this.progressRecords[itemId] ?? {
      bucket: 0,
      stats: { attempts: 0, incorrect: 0, streak: 0 },
    };

    const record: ProgressRecord = {
      ...existing,
      lastAnswer: {
        isCorrect: false,
        answeredAt: new Date().toISOString(),
        timeSpent,
        isSkipped: true,
      },
    };

    this.progressRecords[itemId] = record;
    this.send('SYNC_PROGRESS', { [itemId]: record } as Record<string, ProgressRecord>);
    this.log(`Skipped [${itemId}], timeSpent=${timeSpent}ms`);
    return this;
  }

  /**
   * Bulk-merge external progress records into the internal state and send
   * `SYNC_PROGRESS` to the host.
   *
   * Useful for restoring saved progress after a page refresh, or for
   * synchronising records received from a remote source.
   *
   * @param records  Map of itemId → ProgressRecord to merge.
   */
  syncProgress(records: Record<string, ProgressRecord>): this {
    Object.assign(this.progressRecords, records);
    this.send('SYNC_PROGRESS', records);
    this.log(`syncProgress: ${Object.keys(records).length} records pushed`);
    return this;
  }

  /**
   * Returns a snapshot of the current internal progress state.
   * Keyed by item UUID.
   */
  getProgress(): Record<string, ProgressRecord> {
    return { ...this.progressRecords };
  }

  // -------------------------------------------------------------------------
  // CRUD: Set Mutation
  // -------------------------------------------------------------------------

  /**
   * Persist new or updated items to the host's OPFS copy of the study set.
   * The host merges the supplied items by `id`.
   */
  saveItems(items: OQSEItem[]): this {
    this.send('MUTATE_ITEMS', { items });
    this.log(`saveItems: ${items.length} item(s)`);
    return this;
  }

  /**
   * Delete items from the host's OPFS copy of the study set by their UUIDs.
   */
  deleteItems(itemIds: string[]): this {
    this.send('DELETE_ITEMS', { itemIds });
    this.log(`deleteItems: ${itemIds.length} id(s)`);
    return this;
  }

  /**
   * Update the study set's metadata (title, description, tags, etc.) in OPFS.
   * Only the supplied fields are overwritten; others remain unchanged.
   */
  updateMeta(meta: Partial<OQSEMeta>): this {
    this.send('MUTATE_META', { meta });
    this.log('updateMeta:', Object.keys(meta).join(', '));
    return this;
  }

  // -------------------------------------------------------------------------
  // Asset Bridge (OPFS via Host)
  // -------------------------------------------------------------------------

  /**
   * Upload a `File` or `Blob` asset through the host into OPFS.
   *
   * The host stores the asset, creates a `MediaObject` entry in the set's
   * asset registry, and responds with `ASSET_STORED`. The returned
   * `MediaObject` can be saved to an item via `saveItems()`.
   *
   * @param file          The file or blob to store.
   * @param suggestedKey  Suggested logical key, e.g., `"hero-image"`. The host
   *                      may alter it to guarantee uniqueness.
   * @returns A `Promise<MediaObject>` with the stored asset descriptor.
   *
   * @example
   * ```typescript
   * const media = await plugin.uploadAsset(file, 'skull-model');
   * await plugin.saveItems([{ ...item, assets: { model: media } }]);
   * ```
   */
  uploadAsset(file: File | Blob, suggestedKey?: string): Promise<MediaObject> {
    const requestId = MemizyPlugin.newRequestId();
    const key = suggestedKey ?? (file instanceof File ? file.name : `asset-${requestId}`);

    return new Promise<MediaObject>((resolve, reject) => {
      this.pendingAssetRequests.set(requestId, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.send('STORE_ASSET', { requestId, file, suggestedKey: key });
      this.log(`uploadAsset requestId=${requestId}, key=${key}`);
    });
  }

  /**
   * Request the raw `File` for an asset stored in the host's OPFS.
   *
   * Useful when a plugin needs the original binary (e.g., to display a
   * local 3D model preview) without going through a public URL, bypassing
   * iframe CORS restrictions via the host bridge.
   *
   * @param key  The logical asset key (e.g., `"skull-model"`).
   * @returns A `Promise<File>` with the raw asset data.
   */
  getRawAsset(key: string): Promise<File> {
    const requestId = MemizyPlugin.newRequestId();

    return new Promise<File>((resolve, reject) => {
      this.pendingAssetRequests.set(requestId, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.send('REQUEST_RAW_ASSET', { requestId, key });
      this.log(`getRawAsset requestId=${requestId}, key=${key}`);
    });
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Signal to the host that the session is over (replaces the old
   * `SESSION_COMPLETED` message).
   *
   * @param options  Optional exit metadata (e.g., plugin internal `score`).
   */
  exit(options: ExitOptions = {}): this {
    this.send('EXIT_REQUEST', {
      score: options.score ?? null,
      totalTimeSpent: Date.now() - this.sessionStartTime,
    });
    return this;
  }

  /**
   * Request that the host resize the iframe container.
   * The host MAY ignore this if it controls layout exclusively.
   *
   * @param height  Desired height in pixels, or `'auto'`.
   * @param width   Desired width in pixels, `'auto'`, or `null` (no change).
   */
  requestResize(height: number | 'auto', width: number | 'auto' | null = null): this {
    this.send('RESIZE_REQUEST', { height, width });
    return this;
  }

  /**
   * Log a non-fatal error to the host for telemetry/debugging.
   * The plugin MUST continue running after calling this.
   *
   * @param code     Short camelCase error identifier, e.g., `'UNSUPPORTED_TYPE'`.
   * @param message  Human-readable description.
   */
  reportError(
    code: string,
    message: string,
    options: { itemId?: string; context?: Record<string, unknown> } = {},
  ): this {
    this.send('PLUGIN_ERROR', {
      code,
      message,
      itemId: options.itemId ?? null,
      context: options.context ?? null,
    });
    return this;
  }

  // -------------------------------------------------------------------------
  // Timer utilities
  // -------------------------------------------------------------------------

  /**
   * Start a per-item stopwatch. Call this when the item becomes visible.
   * The elapsed time is automatically included in `answer()` and `skip()`.
   */
  startItemTimer(itemId: string): this {
    this.itemTimers.set(itemId, Date.now());
    return this;
  }

  /**
   * Stop the timer and return elapsed milliseconds. Clears the entry.
   */
  stopItemTimer(itemId: string): number {
    const start = this.itemTimers.get(itemId);
    this.itemTimers.delete(itemId);
    return start !== undefined ? Date.now() - start : 0;
  }

  /**
   * Stop the timer silently (e.g., on abort). Does not return elapsed time.
   */
  clearItemTimer(itemId: string): this {
    this.itemTimers.delete(itemId);
    return this;
  }

  // -------------------------------------------------------------------------
  // Development / standalone helpers
  // -------------------------------------------------------------------------

  /**
   * Provide mock items (and optionally settings, assets, progress) for use
   * when the plugin is opened outside a Memizy host.
   * Suppresses the built-in standalone dialog.
   *
   * @example
   * ```typescript
   * plugin
   *   .useMockData(mockItems, { assets: mockAssets, progress: mockProgress })
   *   .onInit(({ items, progress }) => render(items, progress));
   * ```
   */
  useMockData(
    items: OQSEItem[],
    options?: {
      settings?: Partial<SessionSettings>;
      assets?: Record<string, MediaObject>;
      progress?: Record<string, ProgressRecord>;
    },
  ): this {
    this.mockItems = items;
    this.mockSettings = options?.settings ?? null;
    this.mockAssets = options?.assets ?? null;
    if (options?.progress) this.standaloneProgress = options.progress;
    this.removeStandaloneUi();
    this.scheduleMockFallback();
    return this;
  }

  /**
   * Manually fire `onInit` with mock data immediately.
   * Useful for unit tests or Storybook-style component previews.
   */
  triggerMock(): this {
    if (this.mockItems === null) {
      console.warn('[memizy-plugin-sdk] triggerMock() called but no mock data registered via useMockData().');
      return this;
    }
    this.initialized = true;
    const payload = this.buildMockPayload();
    if (payload.progress) this.progressRecords = { ...payload.progress };
    this.hideStandaloneDialog();
    this.sessionStartTime = Date.now();
    this.initHandler?.(payload);
    return this;
  }

  /**
   * Returns `true` when the plugin is running outside a Memizy host frame.
   */
  isStandalone(): boolean {
    try {
      return window.self === window.top;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  /**
   * Remove the message listener, cancel timers, reject pending asset promises,
   * and remove the standalone UI.
   * Call this if you need to unmount the plugin manually.
   */
  destroy(): void {
    window.removeEventListener('message', this.messageListener);
    this.itemTimers.clear();
    this.removeStandaloneUi();
    if (this.standaloneTimer !== null) {
      clearTimeout(this.standaloneTimer);
      this.standaloneTimer = null;
    }
    // Reject all pending asset bridge promises
    for (const [id, { reject }] of this.pendingAssetRequests) {
      reject(new Error(`[memizy-plugin-sdk] Plugin destroyed while waiting for asset request ${id}`));
    }
    this.pendingAssetRequests.clear();
  }
}
