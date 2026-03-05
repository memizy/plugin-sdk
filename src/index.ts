/**
 * memizy-plugin-sdk
 *
 * Official TypeScript SDK for building Memizy plugins.
 * Abstracts the window.postMessage protocol described in plugin-api-v1.md.
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
 * Standardized OQSE media object. Represents an image, audio, video, or 3D
 * model asset referenced from Rich Content fields via `<asset:key />` tags
 * or from custom item properties like `targetAsset`.
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
   * by the host. Plugins MAY use this to resume spaced-repetition sessions.
   */
  progress?: Record<string, ProgressRecord>;
}

export type AbortReason = 'user_exit' | 'timeout' | 'host_error';

export interface HintResponsePayload {
  itemId: string;
  granted: boolean;
  hintText: string | null;
  fuelCost: number;
  remainingFuel: number;
}

export type SkipReason = 'user_skipped' | 'timeout' | 'not_supported';

export type Confidence = 1 | 2 | 3;

export interface AnswerOptions {
  /** Raw string answer (what the user typed/selected). */
  answer?: string;
  /** User self-reported confidence (1 = unsure, 2 = okay, 3 = confident). */
  confidence?: Confidence;
  /**
   * Time spent in milliseconds. If omitted and `startItemTimer(itemId)` was
   * called, the elapsed time is inferred automatically.
   */
  timeSpent?: number;
}

export interface CompletionOptions {
  /** Plugin's own internal score (0–100). Host calculates its own in parallel. */
  score?: number | null;
}

// ---------------------------------------------------------------------------
// OQSEP types (Open Quiz & Study Exchange — Progress, §2.5)
// ---------------------------------------------------------------------------

/** Aggregate outcome statistics across all past attempts for an item. */
export interface ProgressStats {
  /** Total number of times this item has been answered. MUST be >= 0. */
  attempts: number;
  /** Total count of incorrect answers across all attempts. MUST be >= 0 and <= `attempts`. */
  incorrect: number;
  /** Current consecutive correct-answer streak (reset to 0 on any incorrect). MUST be >= 0. */
  streak: number;
}

/** Details of the most recent answer session for an item. */
export interface ProgressLastAnswer {
  /** Whether the most recent answer was correct. */
  isCorrect: boolean;
  /**
   * User's self-assessed confidence rating (OQSEP 4-point forced scale).
   * 1 = Complete Blackout, 2 = Familiar but Forgotten,
   * 3 = Correct with Effort, 4 = Effortless Recall.
   */
  confidence?: 1 | 2 | 3 | 4;
  /** ISO 8601 timestamp of when the answer was submitted. */
  answeredAt: string;
}

/**
 * Per-item learning progress record from an OQSEP file.
 * Uses a Leitner-inspired 0–4 bucket scale.
 */
export interface ProgressRecord {
  /**
   * Current knowledge level.
   * 0 = new/reset, 1 = learning, 2 = familiar, 3 = consolidated, 4 = mastered.
   */
  bucket: 0 | 1 | 2 | 3 | 4;
  /** ISO 8601 timestamp for the next scheduled review. */
  nextReviewAt?: string;
  /** Aggregate outcome statistics across all past attempts. */
  stats: ProgressStats;
  /** Details of the most recent answer. */
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
   * fetch, payload summary, asset resolution) to the browser console.
   * Useful during development; leave disabled in production.
   * Defaults to `false`.
   */
  debug?: boolean;
  /**
   * Show a floating settings button in standalone mode that lets the user
   * load a study set or progress file at any time. The button is only shown
   * when the plugin runs outside a host iframe.
   * Defaults to `true`. Set to `false` to suppress the built-in UI entirely.
   */
  showStandaloneControls?: boolean;
}

// Internal message envelope
interface HostMessage<T extends string, P = undefined> {
  type: T;
  payload?: P;
}

type IncomingMessage =
  | HostMessage<'INIT_SESSION', InitSessionPayload>
  | HostMessage<'SESSION_RESUMED'>
  | HostMessage<'SESSION_ABORTED', { reason: AbortReason }>
  | HostMessage<'CONFIG_UPDATE', Partial<Pick<SessionSettings, 'theme' | 'locale'>>>
  | HostMessage<'HINT_RESPONSE', HintResponsePayload>;

// ---------------------------------------------------------------------------
// Shadow DOM standalone UI styles — matches Memizy brand (orange primary)
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
// MemizyPlugin
// ---------------------------------------------------------------------------

/**
 * Main SDK class. Instantiate once per plugin page load.
 *
 * **Standalone mode** is handled automatically:
 * - If the plugin is embedded in a Memizy host (iframe), it waits for the
 *   `INIT_SESSION` postMessage as usual.
 * - If it runs directly in a browser window (`window.self === window.top`),
 *   the SDK checks for a `?set=<url>` query parameter and fetches the OQSE
 *   study set automatically, or shows a built-in settings dialog via a
 *   floating gear icon.
 *
 * The developer's `onInit` callback is called identically in all cases.
 *
 * @example
 * ```typescript
 * const plugin = new MemizyPlugin({ id: 'https://my-domain.com/my-quiz', version: '1.0.0' });
 * plugin.onInit(({ items, assets, progress }) => render(items));
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
  private resumedHandler: (() => void) | null = null;
  private abortedHandler: ((reason: AbortReason) => void) | null = null;
  private configUpdateHandler: ((config: Partial<Pick<SessionSettings, 'theme' | 'locale'>>) => void) | null = null;
  private hintHandler: ((response: HintResponsePayload) => void) | null = null;

  // Item timers: itemId → start timestamp (ms)
  private readonly itemTimers = new Map<string, number>();

  // Session-level stopwatch
  private sessionStartTime: number = Date.now();

  // Mock data for standalone / dev mode
  private mockItems: OQSEItem[] | null = null;
  private mockSettings: Partial<SessionSettings> | null = null;
  private mockAssets: Record<string, MediaObject> | null = null;
  private standaloneTimer: ReturnType<typeof setTimeout> | null = null;

  // Progress data loaded in standalone mode
  private standaloneProgress: Record<string, ProgressRecord> | null = null;

  // Whether INIT_SESSION (or standalone equivalent) has been received
  private initialized = false;

  // Shadow DOM host element for the built-in standalone UI (gear + dialog)
  private standaloneUiHost: HTMLElement | null = null;
  // Reference to the overlay inside the Shadow DOM (for show/hide)
  private standaloneOverlay: HTMLElement | null = null;

  // Listener ref so it can be removed later
  private readonly messageListener: (event: MessageEvent) => void;

  constructor(options: MemizyPluginOptions) {
    this.id = options.id;
    this.version = options.version;
    this.standaloneTimeout = options.standaloneTimeout ?? 2000;
    this.debugMode = options.debug ?? false;
    this.showStandaloneControls = options.showStandaloneControls ?? true;

    this.messageListener = this.handleMessage.bind(this);
    window.addEventListener('message', this.messageListener);

    // Send PLUGIN_READY immediately — the host will send INIT_SESSION once it
    // sees this signal, preventing the race condition where INIT_SESSION arrives
    // before the plugin's listener is registered.
    this.send('PLUGIN_READY', {
      id: this.id,
      version: this.version,
    });

    this.log(`SDK v0.2.0 loaded — id=${this.id}, standalone=${window.self === window.top}`);

    // Kick off standalone-mode detection after the current synchronous call
    // stack completes (so onInit has already been registered via chaining).
    queueMicrotask(() => this.maybeInitStandaloneMode());
  }

  // -------------------------------------------------------------------------
  // Private: postMessage helpers
  // -------------------------------------------------------------------------

  private send<T extends string, P>(type: T, payload?: P): void {
    const message = payload !== undefined ? { type, payload } : { type };
    window.parent.postMessage(message, '*');
  }

  /** Logs a message to the console when `debug: true` is set. */
  private log(...args: unknown[]): void {
    if (this.debugMode) console.log('[memizy-plugin-sdk]', ...args);
  }

  private handleMessage(event: MessageEvent): void {
    // Only accept messages from the parent frame. In cross-origin iframes,
    // event.source is the parent Window reference — compare to window.parent.
    if (event.source !== window.parent) return;

    const msg = event.data as IncomingMessage;
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'INIT_SESSION': {
        this.initialized = true;
        this.removeStandaloneUi();
        if (this.standaloneTimer !== null) {
          clearTimeout(this.standaloneTimer);
          this.standaloneTimer = null;
        }
        this.sessionStartTime = Date.now();
        this.log('INIT_SESSION received from host');
        this.initHandler?.(msg.payload as InitSessionPayload);
        break;
      }
      case 'SESSION_RESUMED': {
        this.log('SESSION_RESUMED');
        this.resumedHandler?.();
        break;
      }
      case 'SESSION_ABORTED': {
        const reason = (msg.payload as { reason: AbortReason } | undefined)?.reason ?? 'user_exit';
        this.log('SESSION_ABORTED reason:', reason);
        this.abortedHandler?.(reason);
        this.destroy();
        break;
      }
      case 'CONFIG_UPDATE': {
        this.configUpdateHandler?.(
          msg.payload as Partial<Pick<SessionSettings, 'theme' | 'locale'>>
        );
        break;
      }
      case 'HINT_RESPONSE': {
        this.hintHandler?.(msg.payload as HintResponsePayload);
        break;
      }
      default:
        // Unknown message types are silently ignored (forward compatibility).
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Private: standalone mode
  // -------------------------------------------------------------------------

  /**
   * Runs after the constructor's synchronous stack. Activates standalone mode
   * only when not inside a host iframe and not already initialized (e.g. via
   * triggerMock()).
   */
  private maybeInitStandaloneMode(): void {
    // Already initialized (host sent INIT_SESSION, or triggerMock was called)
    if (this.initialized) return;
    // Running inside a host iframe — do nothing, wait for postMessage
    if (window.self !== window.top) return;

    const params = new URLSearchParams(window.location.search);
    const setUrl = params.get('set');

    // Inject standalone controls (gear button + dialog) if enabled
    if (this.showStandaloneControls) {
      const autoOpen = !setUrl && !this.mockItems;
      this.injectStandaloneUi(autoOpen);
    }

    if (setUrl) {
      this.log('Standalone: ?set= detected, fetching', setUrl);
      void this.fetchOqseAndInit(setUrl);
    } else if (!this.mockItems) {
      this.log('Standalone: no data source, waiting for user input');
      // Dialog is auto-opened above if showStandaloneControls is true
    }
    // When mockItems is set, scheduleMockFallback (called from useMockData)
    // handles the mock timer. The gear icon is available for loading real data.
  }

  // -------------------------------------------------------------------------
  // Private: OQSE loading / parsing
  // -------------------------------------------------------------------------

  /**
   * Fetches an OQSE study-set JSON from `url`, builds an `InitSessionPayload`,
   * and fires the `onInit` callback.
   */
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

      // Compute the base URL used to resolve relative asset paths.
      // Example: "https://host.com/sets/geo/data.json" → "https://host.com/sets/geo/"
      const baseUrl = url.replace(/[^/]*$/, '');

      // Resolve relative paths in meta.assets (set-level shared media)
      const meta = oqse['meta'] as Record<string, unknown> | undefined;
      const metaAssets = (meta?.['assets'] ?? {}) as Record<string, Record<string, unknown>>;
      MemizyPlugin.resolveAssetValues(metaAssets, baseUrl);

      this.log(`Fetched OQSE: ${rawItems.length} items, meta.assets keys:`, Object.keys(metaAssets));

      // Resolve relative paths in each item.assets (item-level media)
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

    // Activate session OUTSIDE the try-catch so plugin errors in onInit
    // propagate normally instead of being silently swallowed.
    this.activateSession(payload);
  }

  /**
   * Parses an OQSE JSON string and fires `onInit`. Used for pasted text and files.
   * Relative asset paths are NOT resolved (no base URL available).
   */
  private initFromOqseText(
    jsonText: string,
    onError?: (msg: string) => void,
  ): void {
    try {
      const oqse = JSON.parse(jsonText) as Record<string, unknown>;

      const rawItems = (oqse['items'] as OQSEItem[] | undefined) ?? [];
      if (!Array.isArray(rawItems)) throw new Error('Missing "items" array.');

      const meta = oqse['meta'] as Record<string, unknown> | undefined;
      const metaAssets = (meta?.['assets'] ?? {}) as Record<string, Record<string, unknown>>;

      this.log(`Parsed OQSE text: ${rawItems.length} items`);

      const payload = this.buildStandalonePayload(
        rawItems,
        metaAssets as Record<string, MediaObject>,
      );
      this.activateSession(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[memizy-plugin-sdk] Failed to parse OQSE text:', msg);
      onError?.(msg);
    }
  }

  /** Reads a File as text and delegates to `initFromOqseText`. */
  private initFromFile(file: File, onError?: (msg: string) => void): void {
    const reader = new FileReader();
    reader.onload = () => this.initFromOqseText(reader.result as string, onError);
    reader.onerror = () => onError?.('Failed to read file.');
    reader.readAsText(file);
  }

  /** Builds a standalone `InitSessionPayload` from raw items and assets. */
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

  /** Common activation logic for standalone and mock modes. */
  private activateSession(payload: InitSessionPayload): void {
    this.initialized = true;
    if (this.standaloneTimer !== null) {
      clearTimeout(this.standaloneTimer);
      this.standaloneTimer = null;
    }
    this.hideStandaloneDialog();
    this.sessionStartTime = Date.now();
    this.log('Calling onInit handler');
    this.initHandler?.(payload);
  }

  // -------------------------------------------------------------------------
  // Private: OQSEP (progress) parsing
  // -------------------------------------------------------------------------

  /**
   * Parses OQSEP JSON text. Returns the records on success or an error string.
   */
  private parseOqsepText(jsonText: string): { records?: Record<string, ProgressRecord>; error?: string } {
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

  /** Reads a File as text, parses as OQSEP, stores the progress. */
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
        setStatus(`\u2713 Progress loaded: ${count} record${count !== 1 ? 's' : ''} (${file.name})`, 's-ok');
        updateIndicator();
      }
    };
    reader.onerror = () => setStatus('Failed to read file.', 's-error');
    reader.readAsText(file);
  }

  // -------------------------------------------------------------------------
  // Private: asset resolution
  // -------------------------------------------------------------------------

  /**
   * Resolves relative `MediaObject.value` paths inside an assets dictionary
   * to absolute URLs using the given base URL.
   *
   * A value is considered relative if it does NOT start with a protocol
   * scheme (e.g., `https://`, `http://`, `data:`). Paths that are already
   * absolute are left untouched.
   */
  private static resolveAssetValues(
    assets: Record<string, Record<string, unknown>>,
    baseUrl: string,
  ): void {
    for (const key of Object.keys(assets)) {
      const media = assets[key];
      if (media == null || typeof media !== 'object') continue;
      const value = media['value'];
      if (typeof value !== 'string') continue;
      // Already absolute — skip
      if (/^[a-z][a-z0-9+\-.]*:/i.test(value)) continue;
      // Resolve relative path against the OQSE file's base URL
      try {
        media['value'] = new URL(value, baseUrl).href;
      } catch {
        // Malformed URL — leave as-is
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private: standalone UI
  // -------------------------------------------------------------------------

  /**
   * Injects the floating gear button and settings dialog (Shadow DOM) into the page.
   * @param autoOpen Whether to show the dialog immediately (vs. requiring a gear click).
   */
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

    // ── Helpers ──
    const $ = (id: string) => shadow.getElementById(id);
    const statusEl = $('status-msg')!;
    const setStatus = (msg: string, cls: string) => {
      statusEl.textContent = msg;
      statusEl.className = `status-bar ${cls}`;
    };
    const clearStatus = () => { statusEl.textContent = ''; statusEl.className = 'status-bar'; };

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

    // ── Toggle dialog ──
    gearBtn.addEventListener('click', () => overlay.classList.toggle('hidden'));
    $('close-btn')!.addEventListener('click', () => overlay.classList.add('hidden'));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });

    // ── Tab switching ──
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

    // ── Study Set: URL ──
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

    // ── Study Set: Paste JSON ──
    const setJsonArea = $('set-json') as HTMLTextAreaElement;
    $('set-json-btn')!.addEventListener('click', () => {
      const text = setJsonArea.value.trim();
      if (!text) { setStatus('Please paste JSON content.', 's-error'); return; }
      clearStatus();
      this.initFromOqseText(text, (msg) => setStatus('\u274c ' + msg, 's-error'));
    });

    // ── Study Set: File upload ──
    const setFileInput = $('set-file') as HTMLInputElement;
    const setDrop = $('set-drop')!;
    setDrop.addEventListener('click', () => setFileInput.click());
    setFileInput.addEventListener('change', () => {
      const file = setFileInput.files?.[0];
      if (file) {
        clearStatus();
        this.initFromFile(file, (msg) => setStatus('\u274c ' + msg, 's-error'));
      }
    });
    setDrop.addEventListener('dragover', (e) => { e.preventDefault(); setDrop.classList.add('drag-over'); });
    setDrop.addEventListener('dragleave', () => setDrop.classList.remove('drag-over'));
    setDrop.addEventListener('drop', (e) => {
      e.preventDefault();
      setDrop.classList.remove('drag-over');
      const file = (e as DragEvent).dataTransfer?.files[0];
      if (file) {
        clearStatus();
        this.initFromFile(file, (msg) => setStatus('\u274c ' + msg, 's-error'));
      }
    });

    // ── Progress: Paste JSON ──
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

    // ── Progress: File upload ──
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

    // Auto-focus URL input when dialog is open
    if (autoOpen) requestAnimationFrame(() => urlInput.focus());
  }

  /** Hides the dialog overlay but keeps the gear button visible. */
  private hideStandaloneDialog(): void {
    this.standaloneOverlay?.classList.add('hidden');
  }

  /** Removes the entire standalone UI element (gear + dialog) from the page. */
  private removeStandaloneUi(): void {
    this.standaloneUiHost?.remove();
    this.standaloneUiHost = null;
    this.standaloneOverlay = null;
  }

  // -------------------------------------------------------------------------
  // Private: mock helpers
  // -------------------------------------------------------------------------

  /** Builds a default InitSessionPayload from mock data. */
  private buildMockPayload(): InitSessionPayload {
    const defaultSettings: SessionSettings = {
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
      settings: defaultSettings,
      progress: this.standaloneProgress ?? undefined,
    };
  }

  /** Schedules the standalone fallback timer once mock data is available. */
  private scheduleMockFallback(): void {
    if (this.initialized || this.mockItems === null) return;
    if (this.standaloneTimer !== null) return; // already scheduled

    this.log(`Mock fallback scheduled (${this.standaloneTimeout}ms)`);
    this.standaloneTimer = setTimeout(() => {
      if (!this.initialized) {
        this.triggerMock();
      }
    }, this.standaloneTimeout);
  }

  // -------------------------------------------------------------------------
  // Host → Plugin callback registration
  // -------------------------------------------------------------------------

  /**
   * Register a callback for when the Host sends `INIT_SESSION`.
   * This is the main entry point for plugin startup logic.
   * In standalone mode the SDK fires this callback automatically.
   */
  onInit(handler: (payload: InitSessionPayload) => void): this {
    this.initHandler = handler;
    return this;
  }

  /**
   * Register a callback for when the Host sends `SESSION_RESUMED`.
   * Restart timers, animations, or game loops here.
   */
  onResumed(handler: () => void): this {
    this.resumedHandler = handler;
    return this;
  }

  /**
   * Register a callback for when the Host sends `SESSION_ABORTED`.
   * Stop timers and release resources. Do NOT send further messages.
   */
  onAborted(handler: (reason: AbortReason) => void): this {
    this.abortedHandler = handler;
    return this;
  }

  /**
   * Register a callback for when the Host sends `CONFIG_UPDATE`
   * (e.g., the user changed the theme or locale mid-session).
   */
  onConfigUpdate(handler: (config: Partial<Pick<SessionSettings, 'theme' | 'locale'>>) => void): this {
    this.configUpdateHandler = handler;
    return this;
  }

  /**
   * Register a callback for the Host's response to a `REQUEST_HINT` message.
   * Check `response.granted` before showing the hint text.
   */
  onHint(handler: (response: HintResponsePayload) => void): this {
    this.hintHandler = handler;
    return this;
  }

  // -------------------------------------------------------------------------
  // Plugin → Host actions
  // -------------------------------------------------------------------------

  /**
   * Report that the user answered an item.
   *
   * If `startItemTimer(itemId)` was called earlier, `timeSpent` is inferred
   * automatically. If neither a timer nor `options.timeSpent` is provided,
   * `timeSpent` defaults to `0`.
   */
  answer(itemId: string, isCorrect: boolean, options: AnswerOptions = {}): this {
    let timeSpent = options.timeSpent;

    if (timeSpent === undefined) {
      if (this.itemTimers.has(itemId)) {
        timeSpent = this.stopItemTimer(itemId);
      } else {
        timeSpent = 0;
      }
    } else if (this.itemTimers.has(itemId)) {
      // Explicit timeSpent given — still clean up the timer
      this.clearItemTimer(itemId);
    }

    this.send('ITEM_ANSWERED', {
      itemId,
      isCorrect,
      timeSpent,
      answer: options.answer ?? null,
      confidence: options.confidence ?? null,
    });

    return this;
  }

  /**
   * Report that the user skipped an item without answering.
   * @param reason  Defaults to `'user_skipped'`.
   */
  skip(itemId: string, reason: SkipReason = 'user_skipped'): this {
    this.clearItemTimer(itemId);
    this.send('ITEM_SKIPPED', { itemId, reason });
    return this;
  }

  /**
   * Signal that the session is over. The Host will display the summary screen.
   * Pass `score` (0–100) if the plugin tracks its own internal score.
   */
  complete(options: CompletionOptions = {}): this {
    this.send('SESSION_COMPLETED', {
      score: options.score ?? null,
      totalTimeSpent: Date.now() - this.sessionStartTime,
    });
    return this;
  }

  /**
   * Signal that the user paused the session from within the plugin
   * (e.g., via an in-game pause menu). The Host may overlay a pause UI.
   */
  pause(): this {
    this.send('SESSION_PAUSED');
    return this;
  }

  /**
   * Push a progress update to the Host HUD.
   * Call this after every `answer()` or `skip()` call for a live progress bar.
   *
   * @param done   Number of items that have been answered or skipped so far.
   * @param total  Total number of items in the session.
   */
  updateProgress(done: number, total: number): this {
    const percentComplete = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
    this.send('PROGRESS_UPDATE', { itemsDone: done, itemsTotal: total, percentComplete });
    return this;
  }

  /**
   * Ask the Host to unlock a hint for the given item.
   * The Host will respond via the `onHint()` callback.
   * The Host may deduct Fuel as a cost.
   */
  requestHint(itemId: string): this {
    this.send('REQUEST_HINT', { itemId });
    return this;
  }

  /**
   * Request that the Host resize the iframe container.
   * The Host MAY ignore this if it controls layout exclusively.
   *
   * @param height  Desired height in pixels, or `'auto'`.
   * @param width   Desired width in pixels, `'auto'`, or `null` (no change).
   */
  requestResize(height: number | 'auto', width: number | 'auto' | null = null): this {
    this.send('RESIZE_REQUEST', { height, width });
    return this;
  }

  /**
   * Log a non-fatal error to the Host for telemetry/debugging.
   * The plugin MUST continue running after calling this.
   *
   * @param code     Short camelCase error identifier, e.g., `'UNSUPPORTED_TYPE'`.
   * @param message  Human-readable description.
   */
  reportError(
    code: string,
    message: string,
    options: { itemId?: string; context?: Record<string, unknown> } = {}
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
   * Start a per-item stopwatch. Call this when the item becomes visible to
   * the user. The elapsed time will be automatically passed to `answer()`.
   */
  startItemTimer(itemId: string): this {
    this.itemTimers.set(itemId, Date.now());
    return this;
  }

  /**
   * Stop the timer and return the elapsed milliseconds.
   * The timer entry is cleared after this call.
   */
  stopItemTimer(itemId: string): number {
    const start = this.itemTimers.get(itemId);
    this.itemTimers.delete(itemId);
    return start !== undefined ? Date.now() - start : 0;
  }

  /**
   * Stop the timer without returning the elapsed time (e.g., on skip or abort).
   */
  clearItemTimer(itemId: string): this {
    this.itemTimers.delete(itemId);
    return this;
  }

  // -------------------------------------------------------------------------
  // Development / standalone helpers
  // -------------------------------------------------------------------------

  /**
   * Provide mock items (and optionally mock settings, assets, and progress)
   * to be used when the plugin is opened outside the Memizy host
   * (no INIT_SESSION arrives within `standaloneTimeout` ms).
   *
   * Calling this will suppress the built-in standalone URL dialog.
   *
   * Call this before `onInit()` so the mock fires correctly:
   * ```typescript
   * plugin.useMockData(mockItems, { assets, progress }).onInit(({ items }) => render(items));
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
    // Suppress the auto standalone UI if it was already injected
    this.removeStandaloneUi();
    this.scheduleMockFallback();
    return this;
  }

  /**
   * Manually fire the `onInit` callback with mock data immediately.
   * Useful for unit tests or Storybook-style component previews.
   */
  triggerMock(): this {
    if (this.mockItems === null) {
      console.warn('[memizy-plugin-sdk] triggerMock() called but no mock data registered via useMockData().');
      return this;
    }
    this.initialized = true;
    this.hideStandaloneDialog();
    this.sessionStartTime = Date.now();
    this.initHandler?.(this.buildMockPayload());
    return this;
  }

  /**
   * Returns `true` when the plugin is running outside a Memizy host frame
   * (i.e., `window.self === window.top`).
   */
  isStandalone(): boolean {
    try {
      return window.self === window.top;
    } catch {
      // Cross-origin parent access throws — we are definitely in an iframe
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  /**
   * Remove the message event listener, cancel pending timers, and remove the
   * standalone UI if present.
   * Called automatically on SESSION_ABORTED.
   * Call manually if you need to unmount the plugin without a host signal.
   */
  destroy(): void {
    window.removeEventListener('message', this.messageListener);
    this.itemTimers.clear();
    this.removeStandaloneUi();
    if (this.standaloneTimer !== null) {
      clearTimeout(this.standaloneTimer);
      this.standaloneTimer = null;
    }
  }
}
