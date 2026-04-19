/**
 * MemizyPlugin — core class.
 * Implements the State-Sync, CRUD & Asset Bridge architecture.
 */

import type {
  LastAnswerObject as ProgressLastAnswer,
  MediaObject,
  OQSEItem,
  OQSEMeta,
  ProgressRecord,
  StatsObject as ProgressStats,
} from '@memizy/oqse';
import type {
  AnswerOptions,
  ExitOptions,
  IncomingMessage,
  InitSessionPayload,
  MemizyPluginOptions,
  SessionFuelState,
  SessionSettings,
} from '../types/messages';

type Bucket = ProgressRecord['bucket'];
import { defaultLeitnerReducer } from './leitner';
import { ItemTimerManager } from './timers';
import { StandaloneStorage } from './storage';
import { importOqseArchive, exportOqseArchive } from './zipBridge';
import type { StandaloneUICallbacks } from '../ui/standalone';
import { StandaloneUI } from '../ui/standalone';

// Re-export so consumers can import everything from '@memizy/plugin-sdk'
export type {
  OQSEItem, OQSEMeta, MediaObject, SessionFuelState, SessionSettings, InitSessionPayload,
};
export type { AnswerOptions, ExitOptions, MemizyPluginOptions };

// ── LEITNER_INTERVALS_DAYS is used inline via the imported reducer ──

/**
 * Official TypeScript SDK for building Memizy plugins.
 *
 * - Handles `INIT_SESSION`, `CONFIG_UPDATE`, `ASSET_STORED`, `RAW_ASSET_PROVIDED`.
 * - Runs the Leitner spaced-repetition reducer on every `answer()` call and
 *   sends `SYNC_PROGRESS` to keep the host's storage in sync.
 * - Exposes CRUD helpers (`saveItems`, `deleteItems`, `updateMeta`).
 * - Bridges `uploadAsset` / `getRawAsset` as `Promise`-based wrappers around
 *   `STORE_ASSET` / `REQUEST_RAW_ASSET`.
 * - Auto-detects standalone mode and shows a branded floating UI.
 */
export class MemizyPlugin {
  private readonly id: string;
  private readonly version: string;
  private readonly standaloneTimeout: number;
  private readonly debugMode: boolean;
  private readonly showStandaloneControls: boolean;
  private readonly standaloneUiPosition: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

  // Registered callbacks
  private initHandler: ((payload: InitSessionPayload) => void) | null = null;
  private configUpdateHandler:
    | ((config: Partial<Pick<SessionSettings, 'theme' | 'locale'>>) => void)
    | null = null;

  // Per-item stopwatch manager
  private readonly timerManager = new ItemTimerManager();

  // Session-level stopwatch
  private sessionStartTime: number = Date.now();

  // Internal progress state — source of truth for SYNC_PROGRESS
  private progressRecords: Record<string, ProgressRecord> = {};

  private sessionAssets: Record<string, import('@memizy/oqse').MediaObject> = {};

  // Mock data for standalone / dev mode
  private mockItems: OQSEItem[] | null = null;
  private mockSettings: Partial<SessionSettings> | null = null;
  private mockAssets: Record<string, MediaObject> | null = null;
  private standaloneTimer: ReturnType<typeof setTimeout> | null = null;

  // Progress loaded in standalone mode (before a session starts)
  private standaloneProgress: Record<string, ProgressRecord> | null = null;

  // Whether INIT_SESSION (or standalone equivalent) has been received
  private initialized = false;

  // Shadow DOM standalone UI instance
  private standaloneUI: StandaloneUI | null = null;

  // IndexedDB storage engine for standalone mode
  private readonly storage = new StandaloneStorage();

  // Asset bridge: pending promise resolvers keyed by requestId
  private readonly pendingAssetRequests = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
  >();

  // Message listener reference for clean removal
  private readonly messageListener: (event: MessageEvent) => void;

  constructor(options: MemizyPluginOptions) {
    this.id                    = options.id;
    this.version               = options.version;
    this.standaloneTimeout      = options.standaloneTimeout ?? 2000;
    this.debugMode               = options.debug ?? false;
    this.showStandaloneControls  = options.showStandaloneControls ?? true;
    this.standaloneUiPosition    = options.standaloneUiPosition ?? 'bottom-right';

    this.messageListener = this.handleMessage.bind(this);
    window.addEventListener('message', this.messageListener);

    this.send('PLUGIN_READY', { id: this.id, version: this.version });
    this.log(`SDK v0.2.1 loaded — id=${this.id}, standalone=${window.self === window.top}`);

    queueMicrotask(() => this.maybeInitStandaloneMode());
  }

  // ── postMessage helpers ──────────────────────────────────────────────────

  private send<T extends string, P>(type: T, payload?: P): void {
    const message = payload !== undefined ? { type, payload } : { type };
    window.parent.postMessage(message, '*');
  }

  private log(...args: unknown[]): void {
    if (this.debugMode) console.log('[memizy-plugin-sdk]', ...args);
  }

  // ── Incoming message routing ─────────────────────────────────────────────

  private handleMessage(event: MessageEvent): void {
    if (event.source !== window.parent) return;
    const msg = event.data as IncomingMessage;
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'INIT_SESSION': {
        const payload = msg.payload as InitSessionPayload;
        this.sessionAssets = payload.assets || {};
        this.initialized = true;
        this.standaloneUI?.destroy();
        this.standaloneUI = null;
        if (this.standaloneTimer !== null) {
          clearTimeout(this.standaloneTimer);
          this.standaloneTimer = null;
        }
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

  // ── Standalone mode ──────────────────────────────────────────────────────

  private async maybeInitStandaloneMode(): Promise<void> {
    if (this.initialized) return;
    if (window.self !== window.top) return;

    // Initialise IndexedDB first — fast no-op on subsequent calls
    await this.storage.init();

    // Auto-restore a previously saved session (bypasses the UI entirely)
    const saved = await this.storage.getSet();
    if (saved) {
      this.log('Standalone: restoring saved set from IndexedDB');
      const savedProgress = await this.storage.getProgress();
      if (savedProgress) this.standaloneProgress = savedProgress;
      const rawPayload = this.buildStandalonePayload(
        saved.items,
        (saved.meta.assets ?? {}) as Record<string, MediaObject>,
      );
      const payload = await this.resolveLocalAssets(rawPayload);
      this.activateSession(payload);
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const setUrl = params.get('set');

    if (this.showStandaloneControls) {
      const autoOpen = !setUrl && !this.mockItems;
      this.standaloneUI = new StandaloneUI(autoOpen, this.buildUICallbacks(), this.standaloneUiPosition);
    }

    if (setUrl) {
      this.log('Standalone: ?set= detected, fetching', setUrl);
      void this.fetchOqseAndInit(setUrl);
    } else if (!this.mockItems) {
      this.log('Standalone: no data source, waiting for user input');
    }
  }

  private buildUICallbacks(): StandaloneUICallbacks {
    return {
      onLoadUrl: (url, onError) => {
        void this.fetchOqseAndInit(url, onError);
      },
      onLoadText: (text, onError) => {
        this.initFromOqseText(text, onError);
      },
      onLoadFile: (file, onError) => {
        this.initFromFile(file, onError);
      },
      onLoadProgressText: (text, onError) => {
        const result = this.parseOqsepText(text);
        if (result.error) {
          onError(result.error);
        } else {
          this.standaloneProgress = result.records!;
          void this.storage.saveProgress(result.records!);
        }
      },
      onLoadProgressFile: (file, onError) => {
        this.loadProgressFromFile(file, onError);
      },
      getStandaloneProgress: () => this.standaloneProgress,
      setStandaloneProgress: (records) => {
        this.standaloneProgress = records;
      },
      onReset: () => {
        void this.storage.clearAll().then(() => location.reload());
      },
      onLoadOqseArchive: (file, onError) => {
        void importOqseArchive(file, this.storage)
          .then(() => location.reload())
          .catch((err: unknown) => onError(String(err)));
      },
      onExportOqse: () => {
        void exportOqseArchive(this.storage);
      },
      onExportProgress: () => {
        const snap = this.getProgress();
        const oqsep = {
          version:   '0.1',
          meta:      { exportedAt: new Date().toISOString() },
          records:   snap,
        };
        const blob   = new Blob([JSON.stringify(oqsep, null, 2)], { type: 'application/json' });
        const url    = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `progress-${Date.now()}.oqsep`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      },
    };
  }

  // ── OQSE loading / parsing ───────────────────────────────────────────────

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
      const metaAssets = (meta?.['assets'] ?? {}) as Record<string, MediaObject>;
      MemizyPlugin.resolveAssetValues(metaAssets, baseUrl);

      for (const item of rawItems) {
        const itemAssets = (item['assets'] ?? {}) as Record<string, MediaObject>;
        if (typeof itemAssets === 'object' && itemAssets !== null) {
          MemizyPlugin.resolveAssetValues(itemAssets, baseUrl);
        }
      }

      this.log(`Fetched OQSE: ${rawItems.length} items`);
      payload = this.buildStandalonePayload(rawItems, metaAssets);
      // Persist to IndexedDB so the set survives a page reload
      void this.storage.saveItems(rawItems);
      void this.storage.updateMeta((meta ?? {}) as Partial<OQSEMeta>);
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
      const metaAssets = (meta?.['assets'] ?? {}) as Record<string, MediaObject>;
      this.log(`Parsed OQSE text: ${rawItems.length} items`);
      const payload = this.buildStandalonePayload(rawItems, metaAssets);
      // Persist to IndexedDB so the set survives a page reload
      void this.storage.saveItems(rawItems);
      void this.storage.updateMeta((meta ?? {}) as Partial<OQSEMeta>);
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
    this.sessionAssets = payload.assets || {};
    if (this.standaloneTimer !== null) {
      clearTimeout(this.standaloneTimer);
      this.standaloneTimer = null;
    }
    if (payload.progress) {
      this.progressRecords = { ...payload.progress };
    }
    this.standaloneUI?.hide();
    this.sessionStartTime = Date.now();
    this.log('Calling onInit handler');
    this.initHandler?.(payload);
  }

  // ── OQSEP (progress) parsing ─────────────────────────────────────────────

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

  private loadProgressFromFile(
    file: File,
    onError: (msg: string) => void,
  ): void {
    const reader = new FileReader();
    reader.onload = () => {
      const result = this.parseOqsepText(reader.result as string);
      if (result.error) {
        onError(result.error);
      } else {
        this.standaloneProgress = result.records!;
        void this.storage.saveProgress(result.records!);
        this.log(`Progress loaded from file: ${Object.keys(result.records!).length} records`);
      }
    };
    reader.onerror = () => onError('Failed to read file.');
    reader.readAsText(file);
  }

  // ── Asset resolution (local blob: URL patching) ─────────────────────────

  /**
   * Scans a payload's `assets` map and each item's `assets` map.
   * Any `value` that matches a key stored in `StandaloneStorage` (e.g. `assets/image.png`)
   * is replaced with a `blob:` URL so the plugin can render it directly.
   * Only used in Standalone Mode after a ZIP import auto-restore.
   */
  private async resolveLocalAssets(payload: InitSessionPayload): Promise<InitSessionPayload> {
    const tryResolve = async (assets: Record<string, MediaObject>): Promise<void> => {
      for (const key of Object.keys(assets)) {
        const media = assets[key]!;
        const val   = media.value;
        if (typeof val === 'string' && /^assets\//i.test(val)) {
          try {
            const blob   = await this.storage.getAsset(val);
            media.value  = URL.createObjectURL(blob);
          } catch {
            // Not in storage — leave as-is
          }
        }
      }
    };
    await tryResolve(payload.assets);
    for (const item of payload.items) {
      const ia = (item['assets'] ?? {}) as Record<string, MediaObject>;
      if (ia && typeof ia === 'object') await tryResolve(ia);
    }
    return payload;
  }

  // ── Static asset URL resolver ─────────────────────────────────────────────

  private static resolveAssetValues(
    assets: Record<string, MediaObject>,
    baseUrl: string,
  ): void {
    for (const key of Object.keys(assets)) {
      const media = assets[key];
      if (media == null || typeof media !== 'object') continue;
      const value = media.value;
      if (typeof value !== 'string') continue;
      if (/^[a-z][a-z0-9+\-.]*:/i.test(value)) continue;
      try {
        media.value = new URL(value, baseUrl).href;
      } catch {
        // Malformed URL — leave as-is
      }
    }
  }

  // ── UUID ─────────────────────────────────────────────────────────────────

  private static newRequestId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  // =========================================================================
  // Text Processing API
  // =========================================================================

  /**
   * [TOKENIZED] Parses raw OQSE text into structured tokens.
   * Returns data tokens, not sanitized HTML.
   * If token text is later inserted into HTML, it MUST be escaped or sanitized before display.
   * Automatically resolves asset keys to MediaObjects.
   */
  parseTextTokens(rawText: string): import('../types/messages').OQSETextToken[] {
    const tokens: import('../types/messages').OQSETextToken[] = [];
    const regex = /<(asset|blank):([^>]+)\s*\/>/g;

    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(rawText)) !== null) {
      if (match.index > lastIndex) {
        tokens.push({ type: 'text', value: rawText.substring(lastIndex, match.index) });
      }

      const tagType = match[1] as 'asset' | 'blank';
      const key = match[2]!.trim();

      if (tagType === 'asset') {
        const media = this.sessionAssets[key];
        tokens.push({ type: 'asset', key, media });
      } else {
        tokens.push({ type: 'blank', key });
      }

      lastIndex = regex.lastIndex;
    }

    if (lastIndex < rawText.length) {
      tokens.push({ type: 'text', value: rawText.substring(lastIndex) });
    }

    return tokens;
  }

  /**
   * [HTML OUTPUT] Renders OQSE text directly to HTML.
   * Converts <asset:key /> tags into <img>, <audio>, or <video> elements.
   * Accepts optional custom Markdown parsers or sanitizers.
   * SECURITY: Without options.sanitizer, output is unsafe and MUST be sanitized before display.
   * With options.sanitizer, output has been sanitized by the caller-provided policy.
   */
  renderHtml(
    rawText: string,
    options?: {
      markdownParser?: (text: string) => string | Promise<string>;
      sanitizer?: (html: string) => string;
    }
  ): string {
    const tokens = this.parseTextTokens(rawText);

    let html = tokens.map(token => {
      if (token.type === 'text') return token.value;
      if (token.type === 'blank') return `<input type="text" data-blank="${token.key}" class="oqse-blank" />`;

      if (token.type === 'asset' && token.media) {
        const url = token.media.value;
        if (token.media.type === 'image') return `<img src="${url}" alt="${token.media.altText || ''}" class="oqse-asset-img" />`;
        if (token.media.type === 'audio') return `<audio src="${url}" controls class="oqse-asset-audio"></audio>`;
        if (token.media.type === 'video') return `<video src="${url}" controls class="oqse-asset-video"></video>`;
      }
      return '';
    }).join('');

    if (options?.markdownParser) {
      const parsed = options.markdownParser(html);
      if (typeof parsed === 'string') {
        html = parsed;
      }
    }
    if (options?.sanitizer) {
      html = options.sanitizer(html);
    }

    return html;
  }

  // ── Mock helpers ─────────────────────────────────────────────────────────

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

  // =========================================================================
  // Public API
  // =========================================================================

  // ── Callback registration ────────────────────────────────────────────────

  /**
   * Register a callback for `INIT_SESSION`.
   * The main entry point for plugin startup logic.
   */
  onInit(handler: (payload: InitSessionPayload) => void): this {
    this.initHandler = handler;
    return this;
  }

  /**
   * Register a callback for `CONFIG_UPDATE`
   * (e.g., user changed theme or locale mid-session).
   */
  onConfigUpdate(
    handler: (config: Partial<Pick<SessionSettings, 'theme' | 'locale'>>) => void,
  ): this {
    this.configUpdateHandler = handler;
    return this;
  }

  // ── State-Sync ───────────────────────────────────────────────────────────

  /**
   * Record an answer for an item.
   * 1. Stops the item timer (or uses `options.timeSpent`).
   * 2. Runs the Leitner reducer to compute the new `ProgressRecord`.
   * 3. Sends `SYNC_PROGRESS` with the updated record.
   */
  answer(itemId: string, isCorrect: boolean, options: AnswerOptions = {}): this {
    let timeSpent = options.timeSpent;
    if (timeSpent === undefined) {
      timeSpent = this.timerManager.has(itemId) ? this.timerManager.stop(itemId) : 0;
    } else if (this.timerManager.has(itemId)) {
      this.timerManager.clear(itemId);
    }

    const existing = this.progressRecords[itemId] ?? null;
    const record = defaultLeitnerReducer(existing, isCorrect, timeSpent, options);
    this.progressRecords[itemId] = record;
    this.send('SYNC_PROGRESS', { [itemId]: record } as Record<string, ProgressRecord>);
    if (this.isStandalone()) void this.storage.saveProgress({ [itemId]: record });
    this.log(
      `answer [${itemId}]: correct=${isCorrect}, bucket=${record.bucket}, streak=${record.stats.streak}`,
    );
    return this;
  }

  /**
   * Record that the user skipped an item without answering.
   * Bucket and stats are NOT modified; only `lastAnswer` is updated with
   * `isSkipped: true`. Sends `SYNC_PROGRESS`.
   */
  skip(itemId: string): this {
    const timeSpent = this.timerManager.has(itemId) ? this.timerManager.stop(itemId) : 0;

    const existing: ProgressRecord = this.progressRecords[itemId] ?? {
      bucket: 0 as Bucket,
      stats: { attempts: 0, incorrect: 0, streak: 0 } as ProgressStats,
    };

    const lastAnswer: ProgressLastAnswer = {
      isCorrect: false,
      answeredAt: new Date().toISOString(),
      timeSpent,
      isSkipped: true,
    };

    const record: ProgressRecord = { ...existing, lastAnswer };
    this.progressRecords[itemId] = record;
    this.send('SYNC_PROGRESS', { [itemId]: record } as Record<string, ProgressRecord>);
    if (this.isStandalone()) void this.storage.saveProgress({ [itemId]: record });
    this.log(`skip [${itemId}], timeSpent=${timeSpent}ms`);
    return this;
  }

  /**
   * Bulk-merge external progress records into the internal state and send
   * `SYNC_PROGRESS` to the host.
   */
  syncProgress(records: Record<string, ProgressRecord>): this {
    Object.assign(this.progressRecords, records);
    this.send('SYNC_PROGRESS', records);
    if (this.isStandalone()) void this.storage.saveProgress(records);
    this.log(`syncProgress: ${Object.keys(records).length} records pushed`);
    return this;
  }

  /** Returns a snapshot of the current internal progress state. */
  getProgress(): Record<string, ProgressRecord> {
    return { ...this.progressRecords };
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────

  /** Persist new or updated items to the host's persistent storage. The host merges by `id`. */
  saveItems(items: OQSEItem[]): this {
    if (this.isStandalone()) void this.storage.saveItems(items);
    this.send('MUTATE_ITEMS', { items });
    this.log(`saveItems: ${items.length} item(s)`);
    return this;
  }

  /** Delete items from the host's persistent storage by their UUIDs. */
  deleteItems(itemIds: string[]): this {
    if (this.isStandalone()) void this.storage.deleteItems(itemIds);
    this.send('DELETE_ITEMS', { itemIds });
    this.log(`deleteItems: ${itemIds.length} id(s)`);
    return this;
  }

  /** Update the study set's metadata (title, description, tags, etc.) in the host's storage. */
  updateMeta(meta: Partial<OQSEMeta>): this {
    if (this.isStandalone()) void this.storage.updateMeta(meta);
    this.send('MUTATE_META', { meta });
    this.log('updateMeta:', Object.keys(meta).join(', '));
    return this;
  }

  // ── Asset bridge ─────────────────────────────────────────────────────────

  /**
   * Upload a `File` or `Blob` asset through the host into its storage.
   * Returns a `Promise<MediaObject>` with the stored asset descriptor.
   */
  uploadAsset(file: File | Blob, suggestedKey?: string): Promise<MediaObject> {
    const requestId = MemizyPlugin.newRequestId();
    const key = suggestedKey ?? (file instanceof File ? file.name : `asset-${requestId}`);

    // Standalone shortcut: persist locally and resolve with a blob: URL immediately
    if (this.isStandalone()) {
      return this.storage.saveAsset(key, file).then(() => {
        const blobUrl = URL.createObjectURL(file);
        const mimeType = file instanceof File ? file.type : (file.type ?? 'application/octet-stream');
        const mediaObject: MediaObject = {
          type: mimeType.startsWith('audio') ? 'audio'
              : mimeType.startsWith('video') ? 'video'
              : mimeType.startsWith('model') || mimeType.includes('gltf') || mimeType.includes('glb') ? 'model'
              : 'image',
          value: blobUrl,
          mimeType,
        };
        this.log(`uploadAsset standalone: key=${key}, url=${blobUrl}`);
        return mediaObject;
      });
    }

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
   * Request the raw `File` or `Blob` for an asset stored in the host's storage.
   * Returns a `Promise<File | Blob>`.
   */
  getRawAsset(key: string): Promise<File | Blob> {
    // Standalone shortcut: read directly from IndexedDB
    if (this.isStandalone()) {
      this.log(`getRawAsset standalone: key=${key}`);
      return this.storage.getAsset(key);
    }

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

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Signal to the host that the session is over.
   * @param options  Optional `score` (0–100).
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
   * The host MAY ignore this.
   */
  requestResize(height: number | 'auto', width: number | 'auto' | null = null): this {
    this.send('RESIZE_REQUEST', { height, width });
    return this;
  }

  /**
   * Log a non-fatal error to the host for telemetry/debugging.
   * The plugin MUST continue running after calling this.
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

  // ── Timer utilities ───────────────────────────────────────────────────────

  /**
   * Start a per-item stopwatch. Call this when the item becomes visible.
   * The elapsed time is automatically included in `answer()` and `skip()`.
   */
  startItemTimer(itemId: string): this {
    this.timerManager.start(itemId);
    return this;
  }

  /** Stop the timer and return elapsed milliseconds. */
  stopItemTimer(itemId: string): number {
    return this.timerManager.stop(itemId);
  }

  /** Stop the timer silently (e.g., on abort). */
  clearItemTimer(itemId: string): this {
    this.timerManager.clear(itemId);
    return this;
  }

  // ── Dev / standalone helpers ──────────────────────────────────────────────

  /**
   * Provide mock items for use when running outside a Memizy host.
   * Suppresses the built-in standalone dialog.
   *
   * @example
   * ```typescript
   * plugin
   *   .useMockData(mockItems, { assets: mockAssets })
   *   .onInit(({ items }) => render(items));
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
    this.standaloneUI?.destroy();
    this.standaloneUI = null;
    this.scheduleMockFallback();
    return this;
  }

  /**
   * Manually fire `onInit` with mock data immediately.
   * Useful for unit tests or Storybook-style previews.
   */
  triggerMock(): this {
    if (this.mockItems === null) {
      console.warn('[memizy-plugin-sdk] triggerMock() called but no mock data set — call useMockData() first.');
      return this;
    }
    this.initialized = true;
    const payload = this.buildMockPayload();
    if (payload.progress) this.progressRecords = { ...payload.progress };
    this.standaloneUI?.hide();
    this.sessionStartTime = Date.now();
    this.initHandler?.(payload);
    return this;
  }

  /** Returns `true` when the plugin is running outside a Memizy host frame. */
  isStandalone(): boolean {
    try {
      return window.self === window.top;
    } catch {
      return false;
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  /**
   * Remove the message listener, cancel timers, reject pending asset promises,
   * and remove the standalone UI.
   */
  destroy(): void {
    window.removeEventListener('message', this.messageListener);
    this.timerManager.clearAll();
    this.standaloneUI?.destroy();
    this.standaloneUI = null;
    if (this.standaloneTimer !== null) {
      clearTimeout(this.standaloneTimer);
      this.standaloneTimer = null;
    }
    for (const [id, { reject }] of this.pendingAssetRequests) {
      reject(new Error(`[memizy-plugin-sdk] Plugin destroyed while waiting for asset request ${id}`));
    }
    this.pendingAssetRequests.clear();
  }
}
