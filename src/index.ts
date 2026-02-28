/**
 * memizy-plugin-sdk
 *
 * Official TypeScript SDK for building Memizy plugins.
 * Abstracts the window.postMessage protocol described in plugin-api-v1.md.
 *
 * @version 0.1.2
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
// Shadow DOM standalone UI styles
// ---------------------------------------------------------------------------

const STANDALONE_UI_CSS = `
  :host {
    all: initial;
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(10, 15, 25, 0.82);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }
  .card {
    background: #1a2535;
    border: 1px solid #2c3e50;
    border-radius: 14px;
    padding: 36px 40px 32px;
    width: min(480px, calc(100vw - 48px));
    box-shadow: 0 24px 64px rgba(0,0,0,0.6);
    color: #e0e8f0;
  }
  .logo {
    font-size: 2.2rem;
    margin-bottom: 10px;
    display: block;
    text-align: center;
  }
  h2 {
    margin: 0 0 6px;
    font-size: 1.25rem;
    font-weight: 700;
    color: #f1c40f;
    text-align: center;
  }
  p {
    margin: 0 0 24px;
    font-size: 0.88rem;
    color: #7f95b0;
    text-align: center;
    line-height: 1.6;
  }
  .row {
    display: flex;
    gap: 10px;
  }
  input {
    flex: 1;
    padding: 11px 14px;
    background: #273548;
    border: 1px solid #344658;
    border-radius: 8px;
    color: #e0e8f0;
    font-size: 0.93rem;
    outline: none;
    min-width: 0;
    transition: border-color 0.15s;
  }
  input:focus { border-color: #3498db; }
  input::placeholder { color: #4a6070; }
  button {
    padding: 11px 20px;
    background: #3498db;
    border: none;
    border-radius: 8px;
    color: #fff;
    font-size: 0.93rem;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    min-width: 44px;
    min-height: 44px;
    transition: background 0.15s;
  }
  button:hover:not(:disabled) { background: #2980b9; }
  button:disabled { opacity: 0.55; cursor: not-allowed; }
  .error {
    margin-top: 10px;
    min-height: 1.3em;
    font-size: 0.83rem;
    color: #e74c3c;
  }
  .hint {
    margin-top: 16px;
    font-size: 0.78rem;
    color: #4a6070;
    text-align: center;
  }
  code {
    background: #273548;
    padding: 1px 5px;
    border-radius: 4px;
    font-family: monospace;
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
 *   study set automatically, or shows a built-in URL-input dialog.
 *
 * The developer's `onInit` callback is called identically in all cases.
 *
 * @example
 * ```typescript
 * const plugin = new MemizyPlugin({ id: 'https://my-domain.com/my-quiz', version: '1.0.0' });
 * plugin.onInit(({ items }) => render(items));
 * ```
 */
export class MemizyPlugin {
  private readonly id: string;
  private readonly version: string;
  private readonly standaloneTimeout: number;

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
  private standaloneTimer: ReturnType<typeof setTimeout> | null = null;

  // Whether INIT_SESSION (or standalone equivalent) has been received
  private initialized = false;

  // Shadow DOM host element for the built-in standalone UI
  private standaloneUiHost: HTMLElement | null = null;

  // Listener ref so it can be removed later
  private readonly messageListener: (event: MessageEvent) => void;

  constructor(options: MemizyPluginOptions) {
    this.id = options.id;
    this.version = options.version;
    this.standaloneTimeout = options.standaloneTimeout ?? 2000;

    this.messageListener = this.handleMessage.bind(this);
    window.addEventListener('message', this.messageListener);

    // Send PLUGIN_READY immediately — the host will send INIT_SESSION once it
    // sees this signal, preventing the race condition where INIT_SESSION arrives
    // before the plugin's listener is registered.
    this.send('PLUGIN_READY', {
      id: this.id,
      version: this.version,
    });

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
        this.initHandler?.(msg.payload as InitSessionPayload);
        break;
      }
      case 'SESSION_RESUMED': {
        this.resumedHandler?.();
        break;
      }
      case 'SESSION_ABORTED': {
        const reason = (msg.payload as { reason: AbortReason } | undefined)?.reason ?? 'user_exit';
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

    if (setUrl) {
      void this.fetchOqseAndInit(setUrl);
    } else {
      this.injectStandaloneUi();
    }
  }

  /**
   * Fetches an OQSE study-set JSON from `url`, builds an `InitSessionPayload`,
   * and fires the `onInit` callback.
   */
  private async fetchOqseAndInit(
    url: string,
    onError?: (msg: string) => void,
  ): Promise<void> {
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

      // Resolve relative paths in each item.assets (item-level media)
      for (const item of rawItems) {
        const itemAssets = (item['assets'] ?? {}) as Record<string, Record<string, unknown>>;
        if (typeof itemAssets === 'object' && itemAssets !== null) {
          MemizyPlugin.resolveAssetValues(itemAssets, baseUrl);
        }
      }

      const payload: InitSessionPayload = {
        sessionId: `standalone-${Date.now()}`,
        items: rawItems,
        settings: {
          shuffle: false,
          masteryMode: false,
          maxItems: null,
          locale: navigator.language.split('-')[0] ?? 'en',
          theme: 'light',
          fuel: { balance: 0, multiplier: 1 },
        },
      };

      this.initialized = true;
      if (this.standaloneTimer !== null) {
        clearTimeout(this.standaloneTimer);
        this.standaloneTimer = null;
      }
      this.removeStandaloneUi();
      this.sessionStartTime = Date.now();
      this.initHandler?.(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[memizy-plugin-sdk] Standalone fetch failed:', msg);
      onError?.(msg);
    }
  }

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

  /** Injects the Shadow DOM URL-input dialog into the page. */
  private injectStandaloneUi(): void {
    const host = document.createElement('div');
    host.setAttribute('data-memizy-standalone', '');
    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = STANDALONE_UI_CSS;

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <span class="logo">🧩</span>
      <h2>Memizy — Standalone Mode</h2>
      <p>Enter the URL of an <code>.oqse.json</code> study-set file to load the plugin.</p>
      <div class="row">
        <input id="url-input" type="url" placeholder="https://example.com/set/data.oqse.json" autocomplete="off" spellcheck="false" />
        <button id="load-btn">Load →</button>
      </div>
      <div class="error" id="error-msg"></div>
      <p class="hint">Tip: append <code>?set=&lt;url&gt;</code> to the page URL to skip this dialog.</p>
    `;

    shadow.appendChild(style);
    shadow.appendChild(card);
    document.body.appendChild(host);
    this.standaloneUiHost = host;

    const input   = shadow.getElementById('url-input')  as HTMLInputElement;
    const btn     = shadow.getElementById('load-btn')   as HTMLButtonElement;
    const errEl   = shadow.getElementById('error-msg')  as HTMLElement;

    const submit = () => {
      const url = input.value.trim();
      if (!url) { errEl.textContent = '⚠️ Please enter a URL.'; return; }
      errEl.textContent = '';
      btn.disabled = true;
      btn.textContent = 'Loading…';
      void this.fetchOqseAndInit(url, (msg) => {
        errEl.textContent = '❌ ' + msg;
        btn.disabled = false;
        btn.textContent = 'Load →';
      });
    };

    btn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

    // Auto-focus after paint so it doesn't steal focus from page scripts
    requestAnimationFrame(() => input.focus());
  }

  /** Removes the injected standalone UI element if present. */
  private removeStandaloneUi(): void {
    this.standaloneUiHost?.remove();
    this.standaloneUiHost = null;
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
      settings: defaultSettings,
    };
  }

  /** Schedules the standalone fallback timer once mock data is available. */
  private scheduleMockFallback(): void {
    if (this.initialized || this.mockItems === null) return;
    if (this.standaloneTimer !== null) return; // already scheduled

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
   * Provide mock items (and optionally mock settings) to be used when the
   * plugin is opened outside the Memizy host (no INIT_SESSION arrives within
   * `standaloneTimeout` ms).
   *
   * Calling this will suppress the built-in standalone URL dialog.
   *
   * Call this before `onInit()` so the mock fires correctly:
   * ```typescript
   * plugin.useMockData(mockItems).onInit(({ items }) => render(items));
   * ```
   */
  useMockData(items: OQSEItem[], settings?: Partial<SessionSettings>): this {
    this.mockItems = items;
    this.mockSettings = settings ?? null;
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
    this.removeStandaloneUi();
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
