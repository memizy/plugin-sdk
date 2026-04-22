/**
 * MemizySDK — v0.3.0
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

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

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

  // Populated once `.connect()` resolves.
  private hostProxy: HostApi | null = null;
  private connection: Connection<HostApi & Methods> | null = null;
  private initPayload: InitSessionPayload | null = null;
  private sessionAborted = false;
  private mode: 'iframe' | 'standalone' | null = null;

  // Namespaced managers. Throw clear errors if accessed pre-connect.
  private _sys: SysManager | null = null;
  private _store: StoreManager | null = null;
  private _assets: AssetManager | null = null;
  private _text: TextManager | null = null;

  // User-supplied lifecycle handlers.
  private configUpdateHandler: ConfigUpdateHandler | null = null;
  private sessionAbortedHandler: SessionAbortedHandler | null = null;

  constructor(options: MemizySDKOptions) {
    this.identity = { id: options.id, version: options.version };
    this.allowedOrigins = options.allowedOrigins ?? ['*'];
    this.handshakeTimeout = options.handshakeTimeout ?? 10_000;
    this.debug = options.debug ?? false;
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

  // ── Connection ──────────────────────────────────────────────────────────

  /**
   * Establish the connection to the host and fetch the initial session.
   *
   * In iframe mode this performs the Penpal handshake with `window.parent`.
   * In standalone mode a mock `HostApi` backed by `sessionStorage` is used.
   */
  async connect(options: ConnectOptions = {}): Promise<InitSessionPayload> {
    if (this.initPayload) return this.initPayload;

    const mode = this.resolveMode(options.mode ?? 'auto');
    this.mode = mode;

    if (mode === 'iframe') {
      this.hostProxy = await this.connectViaPenpal();
    } else {
      this.hostProxy = new MockHost(options.mockData, this.debug);
    }

    const payload = await this.hostProxy.sysInit(this.identity);
    this.bootstrapManagers(payload);
    this.initPayload = payload;
    this.log(`connected (${mode}) — ${payload.items.length} item(s)`);
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
    this.hostProxy = null;
    this.initPayload = null;
    this._sys = null;
    this._store = null;
    this._assets = null;
    this._text = null;
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private resolveMode(requested: 'auto' | 'iframe' | 'standalone'): 'iframe' | 'standalone' {
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

  private bootstrapManagers(payload: InitSessionPayload): void {
    const host = this.hostProxy!;
    const sessionStartedAt = Date.now();
    const assets = { ...payload.assets };

    this._sys = new SysManager(host, sessionStartedAt);
    this._store = new StoreManager(host, {
      items: payload.items,
      meta: payload.setMeta,
      progress: payload.progress ?? {},
    });
    this._assets = new AssetManager(host, assets);
    this._text = new TextManager(assets);
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
