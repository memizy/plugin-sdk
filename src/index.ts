/**
 * memizy-plugin-sdk
 *
 * Official TypeScript SDK for building Memizy plugins.
 * Abstracts the window.postMessage protocol described in plugin-api-v1.md.
 *
 * @version 1.0.0
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
  /** MUST match the `id` field in the plugin's OQSE Application Manifest. */
  pluginId: string;
  /** SemVer string (e.g., "1.0.0"). */
  pluginVersion: string;
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
// MemizyPlugin
// ---------------------------------------------------------------------------

/**
 * Main SDK class. Instantiate once per plugin page load.
 *
 * @example
 * ```typescript
 * const plugin = new MemizyPlugin({ pluginId: 'my-quiz', pluginVersion: '1.0.0' });
 * plugin.useMockData([...]).onInit(({ items }) => render(items));
 * ```
 */
export class MemizyPlugin {
  private readonly pluginId: string;
  private readonly pluginVersion: string;
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

  // Whether INIT_SESSION has been received
  private initialized = false;

  // Listener ref so it can be removed later
  private readonly messageListener: (event: MessageEvent) => void;

  constructor(options: MemizyPluginOptions) {
    this.pluginId = options.pluginId;
    this.pluginVersion = options.pluginVersion;
    this.standaloneTimeout = options.standaloneTimeout ?? 2000;

    this.messageListener = this.handleMessage.bind(this);
    window.addEventListener('message', this.messageListener);

    // Send PLUGIN_READY immediately — the host will send INIT_SESSION once it
    // sees this signal, preventing the race condition where INIT_SESSION arrives
    // before the plugin's listener is registered.
    this.send('PLUGIN_READY', {
      pluginId: this.pluginId,
      pluginVersion: this.pluginVersion,
    });
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
   * automatically. Otherwise supply it via `options.timeSpent`.
   *
   * @throws {Error} if timeSpent cannot be determined.
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
   * Call this before `onInit()` so the mock fires correctly:
   * ```typescript
   * plugin.useMockData(mockItems).onInit(({ items }) => render(items));
   * ```
   */
  useMockData(items: OQSEItem[], settings?: Partial<SessionSettings>): this {
    this.mockItems = items;
    this.mockSettings = settings ?? null;
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
    this.sessionStartTime = Date.now();
    this.initHandler?.(this.buildMockPayload());
    return this;
  }

  /**
   * Returns `true` when the plugin is running outside a Memizy host frame
   * (i.e., `window.parent === window`).
   */
  isStandalone(): boolean {
    try {
      return window.parent === window;
    } catch {
      // Cross-origin parent access throws — we are definitely in an iframe
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  /**
   * Remove the message event listener and cancel pending timers.
   * Called automatically on SESSION_ABORTED.
   * Call manually if you need to unmount the plugin without a host signal.
   */
  destroy(): void {
    window.removeEventListener('message', this.messageListener);
    this.itemTimers.clear();
    if (this.standaloneTimer !== null) {
      clearTimeout(this.standaloneTimer);
      this.standaloneTimer = null;
    }
  }
}
