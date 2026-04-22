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
import { prepareRichTextForDisplay } from '@memizy/oqse';
import type {
  AnswerOptions,
  ExitOptions,
  IncomingMessage,
  InitSessionPayload,
  MemizyPluginOptions,
  SessionAbortedReason,
  SessionSettings,
  StandaloneControlsMode,
} from '../types/messages';

type Bucket = ProgressRecord['bucket'];
import { defaultLeitnerReducer } from './leitner';
import { ItemTimerManager } from './timers';
import type { StandaloneUICallbacks } from '../ui/standalone';
import { StandaloneUI } from '../ui/standalone';

const DEV_STATE_KEY = 'memizy_dev_state';

// Re-export so consumers can import everything from '@memizy/plugin-sdk'
export type {
  OQSEItem, OQSEMeta, MediaObject, SessionSettings, InitSessionPayload,
};
export type { AnswerOptions, ExitOptions, MemizyPluginOptions };

// ── LEITNER_INTERVALS_DAYS is used inline via the imported reducer ──

/**
 * Official TypeScript SDK for building Memizy plugins.
 *
 * - Handles `INIT_SESSION`, `SESSION_ABORTED`, `CONFIG_UPDATE`, `ASSET_STORED`, `RAW_ASSET_PROVIDED`.
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
  private readonly standaloneControlsMode: StandaloneControlsMode;
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
  private mockSetMeta?: OQSEMeta;
  private standaloneTimer: ReturnType<typeof setTimeout> | null = null;

  // Progress loaded in standalone mode (before a session starts)
  private standaloneProgress: Record<string, ProgressRecord> | null = null;

  // Active standalone session items (for sessionStorage persistence).
  private standaloneItems: OQSEItem[] = [];

  // Temporary local binary assets in standalone mode.
  private standaloneAssets = new Map<string, File | Blob>();

  // Whether INIT_SESSION (or standalone equivalent) has been received
  private initialized = false;

  // Host signaled that session is externally terminated.
  private sessionAborted = false;

  // Shadow DOM standalone UI instance
  private standaloneUI: StandaloneUI | null = null;

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
    this.standaloneControlsMode  = options.standaloneControlsMode
      ?? (options.showStandaloneControls === false ? 'hidden' : 'auto');
    this.standaloneUiPosition    = options.standaloneUiPosition ?? 'bottom-right';

    this.messageListener = this.handleMessage.bind(this);
    window.addEventListener('message', this.messageListener);

    this.send('PLUGIN_READY', { id: this.id, version: this.version });
    this.log(`SDK v0.2.1 loaded — id=${this.id}, standalone=${window.self === window.top}`);

    queueMicrotask(() => this.maybeInitStandaloneMode());
  }

  // ── postMessage helpers ──────────────────────────────────────────────────

  private send<T extends string, P>(type: T, payload?: P): void {
    if (this.sessionAborted) {
      this.log(`Ignoring outgoing ${type} because SESSION_ABORTED was received.`);
      return;
    }
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
        this.sessionAborted = false;
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

      case 'SESSION_ABORTED': {
        const payload = (msg.payload ?? {}) as { reason?: SessionAbortedReason };
        this.abortCurrentSession(payload.reason ?? 'host_error');
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

  private abortCurrentSession(reason: SessionAbortedReason): void {
    if (this.sessionAborted) return;
    this.sessionAborted = true;
    this.timerManager.clearAll();
    if (this.standaloneTimer !== null) {
      clearTimeout(this.standaloneTimer);
      this.standaloneTimer = null;
    }
    for (const [id, { reject }] of this.pendingAssetRequests) {
      reject(new Error(`[memizy-plugin-sdk] Session aborted (${reason}) while waiting for asset request ${id}`));
    }
    this.pendingAssetRequests.clear();
    this.log(`SESSION_ABORTED received: reason=${reason}`);
  }

  private canRun(action: string): boolean {
    if (!this.sessionAborted) return true;
    this.log(`Ignored ${action} because SESSION_ABORTED was received.`);
    return false;
  }

  private persistStandaloneState(): void {
    if (!this.isStandalone()) return;
    try {
      sessionStorage.setItem(
        DEV_STATE_KEY,
        JSON.stringify({
          items: this.standaloneItems,
          progress: this.progressRecords,
        }),
      );
    } catch {
      // Ignore storage quota/security errors in dev mode.
    }
  }

  private restoreStandaloneState(): InitSessionPayload | null {
    try {
      const raw = sessionStorage.getItem(DEV_STATE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { items?: unknown; progress?: unknown };
      if (!Array.isArray(parsed.items) || parsed.items.length === 0) return null;

      const restoredItems = parsed.items as OQSEItem[];
      const restoredProgress =
        parsed.progress && typeof parsed.progress === 'object'
          ? parsed.progress as Record<string, ProgressRecord>
          : null;

      this.standaloneProgress = restoredProgress;
      return this.buildStandalonePayload(restoredItems, {});
    } catch {
      return null;
    }
  }

  // ── Standalone mode ──────────────────────────────────────────────────────

  private async maybeInitStandaloneMode(): Promise<void> {
    if (this.initialized) return;
    if (window.self !== window.top) return;

    const restored = this.restoreStandaloneState();
    if (restored) {
      this.log('Standalone: restoring dev session from sessionStorage');
      this.activateSession(restored);
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const setUrl = params.get('set');

    const autoOpen = this.standaloneControlsMode === 'auto' && !setUrl && !this.mockItems;
    const showGearButton = this.standaloneControlsMode === 'auto';
    this.standaloneUI = new StandaloneUI(
      autoOpen,
      this.buildUICallbacks(),
      this.standaloneUiPosition,
      showGearButton,
    );

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
          Object.assign(this.progressRecords, result.records!);
          this.persistStandaloneState();
        }
      },
      onLoadProgressFile: (file, onError) => {
        this.loadProgressFromFile(file, onError);
      },
      getStandaloneProgress: () => this.standaloneProgress,
      setStandaloneProgress: (records) => {
        this.standaloneProgress = records;
        Object.assign(this.progressRecords, records);
        this.persistStandaloneState();
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
      payload = this.buildStandalonePayload(rawItems, metaAssets, meta as OQSEMeta | undefined);
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
      const payload = this.buildStandalonePayload(rawItems, metaAssets, meta as OQSEMeta | undefined);
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
    setMeta?: OQSEMeta,
  ): InitSessionPayload {
    return {
      sessionId: `standalone-${Date.now()}`,
      items,
      assets,
      setMeta,
      settings: {
        locale: navigator.language.split('-')[0] ?? 'en',
        theme: 'light',
      },
      progress: this.standaloneProgress ?? undefined,
    };
  }

  private activateSession(payload: InitSessionPayload): void {
    this.sessionAborted = false;
    this.initialized = true;
    this.standaloneItems = [...payload.items];
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
    this.persistStandaloneState();
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
        Object.assign(this.progressRecords, result.records!);
        this.persistStandaloneState();
        this.log(`Progress loaded from file: ${Object.keys(result.records!).length} records`);
      }
    };
    reader.onerror = () => onError('Failed to read file.');
    reader.readAsText(file);
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
   * [HTML OUTPUT] Renders OQSE text directly to HTML using the core pipeline.
   * Ensures safe ordering: Tokenize -> Markdown -> Sanitize -> Detokenize.
   * SECURITY: Without options.sanitizer, output is unsafe and MUST be sanitized before display.
   */
  renderHtml(
    rawText: string,
    options?: {
      markdownParser?: (text: string) => string | Promise<string>;
      sanitizer?: (html: string) => string;
    }
  ): string {
    const mdParser = (text: string) => {
      const parsed = options?.markdownParser ? options.markdownParser(text) : text;
      return typeof parsed === 'string' ? parsed : text;
    };

    const htmlSanitizer = options?.sanitizer ? options.sanitizer : (html: string) => html;

    return prepareRichTextForDisplay(
      rawText,
      undefined,
      {
        markdownParser: mdParser,
        htmlSanitizer,
        assetReplacer: (key) => {
          const media = this.sessionAssets[key];
          if (!media) return '';
          const url = media.value;
          if (media.type === 'image') return `<img src="${url}" alt="${media.altText || ''}" class="oqse-asset-img" />`;
          if (media.type === 'audio') return `<audio src="${url}" controls class="oqse-asset-audio"></audio>`;
          if (media.type === 'video') return `<video src="${url}" controls class="oqse-asset-video"></video>`;
          return '';
        },
        blankReplacer: (key) => `<input type="text" data-blank="${key}" class="oqse-blank" />`,
      }
    );
  }

  // ── Mock helpers ─────────────────────────────────────────────────────────

  private buildMockPayload(): InitSessionPayload {
    const defaults: SessionSettings = {
      locale: navigator.language.split('-')[0] ?? 'en',
      theme: 'light',
      ...this.mockSettings,
    };
    return {
      sessionId: `mock-${Date.now()}`,
      items: this.mockItems ?? [],
      assets: this.mockAssets ?? {},
      setMeta: this.mockSetMeta,
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
    if (!this.canRun('answer')) return this;
    let timeSpent = options.timeSpent;
    if (timeSpent === undefined) {
      timeSpent = this.timerManager.has(itemId) ? this.timerManager.stop(itemId) : 0;
    } else if (this.timerManager.has(itemId)) {
      this.timerManager.clear(itemId);
    }

    const existing = this.progressRecords[itemId] ?? null;
    const reduced = defaultLeitnerReducer(existing, isCorrect, timeSpent, options);
    const record = reduced.lastAnswer
      ? {
        ...reduced,
        lastAnswer: {
          ...reduced.lastAnswer,
          hintsUsed: options?.hintsUsed ?? 0,
        },
      }
      : reduced;
    this.progressRecords[itemId] = record;
    this.send('SYNC_PROGRESS', { [itemId]: record } as Record<string, ProgressRecord>);
    this.persistStandaloneState();
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
    if (!this.canRun('skip')) return this;
    const timeSpent = this.timerManager.has(itemId) ? this.timerManager.stop(itemId) : 0;

    const existing: ProgressRecord = this.progressRecords[itemId] ?? {
      bucket: 0 as Bucket,
      stats: { attempts: 0, incorrect: 0, streak: 0 } as ProgressStats,
    };

    const lastAnswer: ProgressLastAnswer = {
      isCorrect: false,
      answeredAt: new Date().toISOString(),
      timeSpent,
      hintsUsed: 0,
      isSkipped: true,
    };

    const record: ProgressRecord = { ...existing, lastAnswer };
    this.progressRecords[itemId] = record;
    this.send('SYNC_PROGRESS', { [itemId]: record } as Record<string, ProgressRecord>);
    this.persistStandaloneState();
    this.log(`skip [${itemId}], timeSpent=${timeSpent}ms`);
    return this;
  }

  /**
   * Bulk-merge external progress records into the internal state and send
   * `SYNC_PROGRESS` to the host.
   */
  syncProgress(records: Record<string, ProgressRecord>): this {
    if (!this.canRun('syncProgress')) return this;
    Object.assign(this.progressRecords, records);
    this.send('SYNC_PROGRESS', records);
    this.persistStandaloneState();
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
    if (!this.canRun('saveItems')) return this;
    if (this.isStandalone()) {
      const map = new Map(this.standaloneItems.map(it => [it.id, it]));
      for (const item of items) map.set(item.id, item);
      this.standaloneItems = [...map.values()];
    }
    this.send('MUTATE_ITEMS', { items });
    this.persistStandaloneState();
    this.log(`saveItems: ${items.length} item(s)`);
    return this;
  }

  /** Delete items from the host's persistent storage by their UUIDs. */
  deleteItems(itemIds: string[]): this {
    if (!this.canRun('deleteItems')) return this;
    if (this.isStandalone()) {
      const toDelete = new Set(itemIds);
      this.standaloneItems = this.standaloneItems.filter(item => !toDelete.has(item.id));
    }
    this.send('DELETE_ITEMS', { itemIds });
    this.persistStandaloneState();
    this.log(`deleteItems: ${itemIds.length} id(s)`);
    return this;
  }

  /** Update the study set's metadata (title, description, tags, etc.) in the host's storage. */
  updateMeta(meta: Partial<OQSEMeta>): this {
    if (!this.canRun('updateMeta')) return this;
    if (this.isStandalone()) {
      const incomingAssets = meta.assets as Record<string, MediaObject> | undefined;
      if (incomingAssets && typeof incomingAssets === 'object') {
        this.sessionAssets = { ...this.sessionAssets, ...incomingAssets };
      }
    }
    this.send('MUTATE_META', { meta });
    this.persistStandaloneState();
    this.log('updateMeta:', Object.keys(meta).join(', '));
    return this;
  }

  // ── Asset bridge ─────────────────────────────────────────────────────────

  /**
   * Upload a `File` or `Blob` asset through the host into its storage.
   * Returns a `Promise<MediaObject>` with the stored asset descriptor.
   */
  uploadAsset(file: File | Blob, suggestedKey?: string): Promise<MediaObject> {
    if (!this.canRun('uploadAsset')) {
      return Promise.reject(new Error('[memizy-plugin-sdk] uploadAsset() ignored after SESSION_ABORTED'));
    }
    const requestId = MemizyPlugin.newRequestId();
    const key = suggestedKey ?? (file instanceof File ? file.name : `asset-${requestId}`);

    // Standalone shortcut: store temporary in-memory asset and resolve immediately.
    if (this.isStandalone()) {
      this.standaloneAssets.set(key, file);
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
      this.sessionAssets[key] = mediaObject;
      this.log(`uploadAsset standalone: key=${key}, url=${blobUrl}`);
      return Promise.resolve(mediaObject);
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
    if (!this.canRun('getRawAsset')) {
      return Promise.reject(new Error('[memizy-plugin-sdk] getRawAsset() ignored after SESSION_ABORTED'));
    }
    // Standalone shortcut: read from temporary in-memory asset map.
    if (this.isStandalone()) {
      this.log(`getRawAsset standalone: key=${key}`);
      const file = this.standaloneAssets.get(key);
      if (!file) {
        return Promise.reject(new Error(`[memizy-plugin-sdk] Standalone asset not found: ${key}`));
      }
      return Promise.resolve(file);
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
    if (!this.canRun('exit')) return this;
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
    if (!this.canRun('requestResize')) return this;
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
    if (!this.canRun('reportError')) return this;
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
    if (!this.canRun('startItemTimer')) return this;
    this.timerManager.start(itemId);
    return this;
  }

  /** Stop the timer and return elapsed milliseconds. */
  stopItemTimer(itemId: string): number {
    if (!this.canRun('stopItemTimer')) return 0;
    return this.timerManager.stop(itemId);
  }

  /** Stop the timer silently (e.g., on abort). */
  clearItemTimer(itemId: string): this {
    if (!this.canRun('clearItemTimer')) return this;
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
      setMeta?: OQSEMeta;
    },
  ): this {
    this.mockItems = items;
    this.mockSettings = options?.settings ?? null;
    this.mockAssets = options?.assets ?? null;
    this.mockSetMeta = options?.setMeta;
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
    this.sessionAborted = false;
    this.initialized = true;
    const payload = this.buildMockPayload();
    this.standaloneItems = [...payload.items];
    this.sessionAssets = payload.assets || {};
    if (payload.progress) this.progressRecords = { ...payload.progress };
    this.persistStandaloneState();
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

  /**
   * Safely retrieves URL search parameters passed to the plugin iframe.
   * Useful for reading launch parameters provided by the host (e.g., `?mode=edit`).
   * @returns A key-value record of URL parameters.
   */
  public getLaunchParams(): Record<string, string> {
    const params: Record<string, string> = {};
    try {
      const search = new URLSearchParams(window.location.search);
      search.forEach((value, key) => {
        params[key] = value;
      });
    } catch (e) {
      this.log('Failed to parse URL parameters.', 'err');
    }
    return params;
  }

  /**
   * Manually open the standalone controls dialog.
   * Useful with `standaloneControlsMode: 'hidden'` when the plugin controls when UI should appear.
   */
  openStandaloneControls(): this {
    if (!this.isStandalone()) return this;
    if (!this.standaloneUI) {
      this.standaloneUI = new StandaloneUI(
        false,
        this.buildUICallbacks(),
        this.standaloneUiPosition,
        false,
      );
    }
    this.standaloneUI.show();
    return this;
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
    this.standaloneAssets.clear();
  }
}
