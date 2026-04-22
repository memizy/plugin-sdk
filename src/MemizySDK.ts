/**
 * MemizySDK — v0.3.1
 *
 * Entry point for Memizy plugins. Usage:
 *
 *   const plugin = new MemizySDK({ id: 'my-plugin', version: '1.0.0' });
 *   const { items, settings } = await plugin.connect();
 *   plugin.store.answer(items[0].id, true);
 *
 * The SDK handles:
 *  - Penpal handshake with the host (iframe mode).
 *  - A drop-in mock host backed by `sessionStorage` (standalone mode).
 *  - A brand-aligned Shadow-DOM Standalone UI (study-set / progress loader).
 *  - Lifecycle events pushed by the host (`onConfigUpdate`, `onSessionAborted`).
 */

import type { Methods, Connection } from 'penpal';
import { WindowMessenger, connect } from 'penpal';

import { AssetManager } from './managers/AssetManager';
import { StoreManager } from './managers/StoreManager';
import { SysManager } from './managers/SysManager';
import { TextManager } from './managers/TextManager';
import type {
  ConfigUpdate,
  HostApi,
  InitSessionPayload,
  PluginApi,
  PluginIdentity,
  SessionAbortedReason,
} from './rpc/types';
import { MockHost, type StandaloneMockData } from './standalone/MockHost';
import {
  StandaloneUI,
  type StandaloneUICallbacks,
  type StandaloneUiPosition,
} from './standalone/StandaloneUI';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** When and how to show the built-in Standalone UI in dev mode. */
export type StandaloneControlsMode = 'auto' | 'hidden';

export interface MemizySDKOptions extends PluginIdentity {
  /**
   * Origins the plugin will accept messages from. Defaults to `['*']`
   * (any origin) — set this to a stricter allow-list in production.
   */
  allowedOrigins?: (string | RegExp)[];
  /** Penpal handshake timeout in milliseconds. Defaults to 10_000. */
  handshakeTimeout?: number;
  /** Log lifecycle events to the console. Defaults to `false`. */
  debug?: boolean;

  // ── Standalone-only options ──
  /**
   * Controls the Standalone UI gear and auto-open behaviour.
   *  - `'auto'`   — shows the floating gear and auto-opens the modal when
   *                 no data is available. (default)
   *  - `'hidden'` — never shows the gear; the plugin triggers the modal
   *                 via `sdk.openStandaloneUI()` if needed.
   */
  standaloneControlsMode?: StandaloneControlsMode;
  /**
   * Corner where the floating gear anchors. Defaults to `'top-right'`.
   * Only applies in standalone mode with `standaloneControlsMode: 'auto'`.
   */
  standaloneUiPosition?: StandaloneUiPosition;
}

export interface ConnectOptions {
  /** Seed data used when the SDK falls back into standalone mode. */
  mockData?: StandaloneMockData;
  /**
   * Override auto-detection and force a specific connection mode.
   * Useful in tests; production plugins should rely on auto-detection.
   */
  mode?: 'auto' | 'iframe' | 'standalone';
}

// ---------------------------------------------------------------------------
// Lifecycle callback shapes
// ---------------------------------------------------------------------------

export type ConfigUpdateHandler = (config: ConfigUpdate) => void;
export type SessionAbortedHandler = (reason: SessionAbortedReason) => void;

// ---------------------------------------------------------------------------
// SDK
// ---------------------------------------------------------------------------

export class MemizySDK {
  readonly identity: PluginIdentity;

  private readonly allowedOrigins: (string | RegExp)[];
  private readonly handshakeTimeout: number;
  private readonly debug: boolean;
  private readonly standaloneControlsMode: StandaloneControlsMode;
  private readonly standaloneUiPosition: StandaloneUiPosition;

  // Populated once `.connect()` resolves.
  private hostProxy: HostApi | null = null;
  private connection: Connection<HostApi & Methods> | null = null;
  private initPayload: InitSessionPayload | null = null;
  private sessionAborted = false;
  private mode: 'iframe' | 'standalone' | null = null;

  // Standalone-only references.
  private mockHost: MockHost | null = null;
  private standaloneUI: StandaloneUI | null = null;

  // Namespaced managers. Throw clear errors if accessed pre-connect.
  private _sys: SysManager | null = null;
  private _store: StoreManager | null = null;
  private _assets: AssetManager | null = null;
  private _text: TextManager | null = null;

  // User-supplied lifecycle handlers.
  private configUpdateHandler: ConfigUpdateHandler | null = null;
  private sessionAbortedHandler: SessionAbortedHandler | null = null;
  private setUpdatedHandler: (() => void) | null = null;

  constructor(options: MemizySDKOptions) {
    this.identity = { id: options.id, version: options.version };
    this.allowedOrigins = options.allowedOrigins ?? ['*'];
    this.handshakeTimeout = options.handshakeTimeout ?? 10_000;
    this.debug = options.debug ?? false;
    this.standaloneControlsMode = options.standaloneControlsMode ?? 'auto';
    this.standaloneUiPosition = options.standaloneUiPosition ?? 'top-right';
  }

  // ── Namespaced API (post-connect) ───────────────────────────────────────

  get sys(): SysManager {
    return this.assertReady(this._sys, 'sys');
  }
  get store(): StoreManager {
    return this.assertReady(this._store, 'store');
  }
  get assets(): AssetManager {
    return this.assertReady(this._assets, 'assets');
  }
  get text(): TextManager {
    return this.assertReady(this._text, 'text');
  }

  /** Initial data returned by `HostApi.sysInit()`. `null` until connected. */
  get session(): InitSessionPayload | null {
    return this.initPayload;
  }

  /** `true` when running without a real Memizy host frame. */
  get isStandalone(): boolean {
    return this.mode === 'standalone';
  }

  // ── Lifecycle listeners ─────────────────────────────────────────────────

  /** Register a callback for host-pushed config changes (theme/locale). */
  onConfigUpdate(handler: ConfigUpdateHandler): this {
    this.configUpdateHandler = handler;
    return this;
  }

  /** Register a callback for externally-triggered session termination. */
  onSessionAborted(handler: SessionAbortedHandler): this {
    this.sessionAbortedHandler = handler;
    return this;
  }

  /**
   * Register a callback invoked whenever the underlying study set is
   * swapped mid-session — e.g. via the Standalone UI modal or the
   * `?set=<url>` auto-loader. The SDK's managers have already been
   * refreshed by the time this fires, so plugins can simply re-render.
   */
  onSetUpdated(handler: () => void): this {
    this.setUpdatedHandler = handler;
    return this;
  }

  /**
   * Manually open the Standalone UI modal. Useful when using
   * `standaloneControlsMode: 'hidden'` and the plugin wants to offer its
   * own "Load another set…" button.
   *
   * No-op outside standalone mode.
   */
  openStandaloneUI(): void {
    if (this.mode !== 'standalone') return;
    if (!this.standaloneUI) {
      // Lazily create even if the mode is 'hidden' — user asked for it.
      this.standaloneUI = this.buildStandaloneUI(false);
    }
    this.standaloneUI.open();
  }

  // ── Connection ──────────────────────────────────────────────────────────

  /**
   * Establish the connection to the host and fetch the initial session.
   *
   * In iframe mode this performs the Penpal handshake with `window.parent`.
   * In standalone mode a mock `HostApi` backed by `sessionStorage` is used;
   * if no data is available, the Standalone UI is shown and this method
   * waits until the user supplies an OQSE payload before resolving.
   */
  async connect(options: ConnectOptions = {}): Promise<InitSessionPayload> {
    if (this.initPayload) return this.initPayload;

    const mode = this.resolveMode(options.mode ?? 'auto');
    this.mode = mode;

    if (mode === 'iframe') {
      this.hostProxy = await this.connectViaPenpal();
    } else {
      this.hostProxy = await this.bootstrapStandalone(options.mockData);
    }

    const payload = await this.hostProxy.sysInit(this.identity);
    this.bootstrapManagers(payload);
    this.initPayload = payload;
    this.log(`connected (${mode}) — ${payload.items.length} item(s)`);

    // Once the plugin has data, hide the modal but keep the gear in place
    // so developers can swap decks mid-session.
    this.standaloneUI?.close();
    return payload;
  }

  /**
   * Tear down the connection and clear in-memory state. Safe to call
   * multiple times.
   */
  destroy(): void {
    this._store?._clearAllTimers();
    this.connection?.destroy();
    this.connection = null;
    this.standaloneUI?.destroy();
    this.standaloneUI = null;
    this.mockHost = null;
    this.hostProxy = null;
    this.initPayload = null;
    this._sys = null;
    this._store = null;
    this._assets = null;
    this._text = null;
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private resolveMode(
    requested: 'auto' | 'iframe' | 'standalone',
  ): 'iframe' | 'standalone' {
    if (requested !== 'auto') return requested;
    try {
      return window.self === window.top ? 'standalone' : 'iframe';
    } catch {
      // Accessing `window.top` across origins can throw — that means we
      // ARE embedded, so iframe mode is correct.
      return 'iframe';
    }
  }

  private async connectViaPenpal(): Promise<HostApi> {
    const messenger = new WindowMessenger({
      remoteWindow: window.parent,
      allowedOrigins: this.allowedOrigins,
    });

    const pluginMethods: PluginApi = {
      onConfigUpdate: async (config) => {
        this.log('onConfigUpdate', config);
        this.configUpdateHandler?.(config);
      },
      onSessionAborted: async (reason) => {
        this.log('onSessionAborted', reason);
        this.sessionAborted = true;
        this._store?._clearAllTimers();
        this.sessionAbortedHandler?.(reason);
      },
    };

    this.connection = connect<HostApi & Methods>({
      messenger,
      methods: pluginMethods as unknown as Methods,
      timeout: this.handshakeTimeout,
      log: this.debug ? (...args) => console.log('[penpal]', ...args) : undefined,
    });

    return this.connection.promise;
  }

  // ── Standalone orchestration ────────────────────────────────────────────

  /**
   * Prepare standalone mode: construct the `MockHost`, handle the
   * `?set=<url>` auto-loader, and — if no data is available — show the
   * Standalone UI and arm the pending-init gate so `sysInit()` blocks
   * until the user provides a study set.
   *
   * Priority order:
   *   1. `?set=<url>` URL parameter — when no existing session is present,
   *      auto-loads the URL. When an existing session (mockData or
   *      restored `sessionStorage`) is present, prompts the user via a
   *      confirmation dialog before overwriting.
   *   2. `mockData` passed to `connect()`, or previously persisted
   *      `sessionStorage` state.
   *   3. Interactive load via the Standalone UI modal.
   */
  private async bootstrapStandalone(
    mockData: StandaloneMockData | undefined,
  ): Promise<HostApi> {
    const setUrl = readSetUrlParam();

    // Construct the mock WITHOUT `forceFresh` first so we can detect a
    // pre-existing session (mockData or restored `sessionStorage`). If the
    // user declines to overwrite it, we'll keep the existing state.
    const mock = new MockHost(mockData, this.debug);
    this.mockHost = mock;
    const hasSeed = mock.hasStudySet();

    // Case 1 — ?set= URL auto-loader.
    if (setUrl) {
      if (hasSeed) {
        // Existing session detected — give the user a chance to bail out
        // before we clobber their data. We build the UI eagerly (without
        // opening the main modal) so we can pop the confirmation dialog
        // on top.
        this.standaloneUI = this.buildStandaloneUI(false);
        const confirmed = await this.standaloneUI.confirmOverwrite();
        if (!confirmed) {
          this.log(
            `?set=${setUrl} ignored — user kept existing session.`,
          );
          return mock;
        }
      } else if (this.standaloneControlsMode === 'auto') {
        this.standaloneUI = this.buildStandaloneUI(false);
      }

      try {
        await this.loadSetFromUrl(setUrl);
      } catch (err) {
        console.warn(
          `[memizy-plugin-sdk/standalone] Failed to auto-load ?set=${setUrl}:`,
          err,
        );
        if (mock.hasStudySet()) {
          // Partial failure but we still have usable data — just surface
          // the UI so the developer can retry.
          this.standaloneUI ??= this.buildStandaloneUI(false);
        } else {
          // No data anywhere — fall through to the UI-driven path.
          mock.markPendingInit();
          this.standaloneUI ??= this.buildStandaloneUI(true);
          this.standaloneUI.open();
        }
      }
      return mock;
    }

    // Case 2 — data already present (mockData or restored sessionStorage).
    if (hasSeed) {
      if (this.standaloneControlsMode === 'auto') {
        this.standaloneUI = this.buildStandaloneUI(false);
      }
      return mock;
    }

    // Case 3 — no data anywhere: arm the gate and open the UI.
    mock.markPendingInit();
    this.standaloneUI = this.buildStandaloneUI(this.standaloneControlsMode === 'auto');
    if (this.standaloneControlsMode === 'hidden') {
      // The developer asked us to stay out of the way, but there's no
      // other way to get data. Open the modal once — they can hide the
      // gear afterwards.
      this.standaloneUI.open();
    }
    return mock;
  }

  private buildStandaloneUI(autoOpen: boolean): StandaloneUI {
    const afterSet = async (): Promise<void> => {
      // Only refresh if the plugin has already completed its first connect;
      // during the initial bootstrap the pending-init gate handles things.
      if (this.initPayload) await this.refreshAfterExternalSetLoad();
    };

    const callbacks: StandaloneUICallbacks = {
      loadSetFromUrl: async (url) => {
        await this.loadSetFromUrl(url);
        await afterSet();
      },
      loadSetFromText: async (text) => {
        this.mockHost!.loadSetFromJson(text);
        await afterSet();
      },
      loadSetFromFile: async (file) => {
        this.mockHost!.loadSetFromJson(await file.text());
        await afterSet();
      },
      loadProgressFromText: async (text) => {
        this.mockHost!.loadProgressFromJson(text);
        await afterSet();
      },
      loadProgressFromFile: async (file) => {
        this.mockHost!.loadProgressFromJson(await file.text());
        await afterSet();
      },
      getProgressCount: () => this.mockHost?.getProgressCount() ?? 0,
      hasStudySet: () => this.mockHost?.hasStudySet() ?? false,
    };

    return new StandaloneUI({
      autoOpen,
      showGear: this.standaloneControlsMode === 'auto',
      position: this.standaloneUiPosition,
      callbacks,
    });
  }

  private async loadSetFromUrl(url: string): Promise<void> {
    if (!this.mockHost) throw new Error('Standalone mock host is not initialised.');
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} — ${resp.statusText}`);
    const text = await resp.text();
    this.mockHost.loadSetFromJson(text, { jsonUrl: url });
  }

  // ── Managers ────────────────────────────────────────────────────────────

  private bootstrapManagers(payload: InitSessionPayload): void {
    const host = this.hostProxy!;
    const sessionStartedAt = Date.now();
    const assets = { ...payload.assets };

    // Hot-swap path: keep existing manager instances (plugins may have
    // already captured references to them) and just rebind their state.
    if (this._store && this._assets && this._text) {
      this._store._updateSnapshot({
        items: payload.items,
        meta: payload.setMeta,
        progress: payload.progress ?? {},
      });
      this._assets._replaceAll(assets);
      this._text._replaceAssets(assets);
      return;
    }

    this._sys = new SysManager(host, sessionStartedAt);
    this._store = new StoreManager(host, {
      items: payload.items,
      meta: payload.setMeta,
      progress: payload.progress ?? {},
    });
    this._assets = new AssetManager(host, assets);
    this._text = new TextManager(assets);
  }

  /**
   * Pull a fresh session payload from the (mock) host, re-bind the
   * managers, and fire the `onSetUpdated` callback. Called whenever the
   * Standalone UI swaps the underlying study set.
   */
  private async refreshAfterExternalSetLoad(): Promise<void> {
    if (!this.hostProxy) return;
    const payload = await this.hostProxy.sysInit(this.identity);
    this.bootstrapManagers(payload);
    this.initPayload = payload;
    this.log(`set updated (standalone) — ${payload.items.length} item(s)`);
    this.setUpdatedHandler?.();
  }

  private assertReady<T>(value: T | null, name: string): T {
    if (value === null) {
      throw new Error(
        `[memizy-plugin-sdk] plugin.${name} accessed before .connect() resolved`,
      );
    }
    return value;
  }

  private log(...args: unknown[]): void {
    if (this.debug) console.log('[memizy-plugin-sdk]', ...args);
  }

  /** @internal — for tests. */
  get _sessionAborted(): boolean {
    return this.sessionAborted;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readSetUrlParam(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('set');
  } catch {
    return null;
  }
}
