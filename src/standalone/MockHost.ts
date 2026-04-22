/**
 * Standalone-mode mock of the `HostApi`.
 *
 * When the plugin iframe is actually the top-level window (i.e. the developer
 * is running the plugin directly on `localhost` without a Memizy host), we
 * swap the real Penpal proxy for this in-memory implementation.
 *
 * State is persisted to `sessionStorage` under a single key so that a page
 * refresh preserves the current session (progress + item mutations),
 * mirroring the behaviour of the real host during development.
 *
 * `sysInit()` supports a **pending-init gate**: when the plugin has not yet
 * been seeded with study-set data, the SDK arms the gate and opens the
 * Standalone UI. `sysInit()` will then block until the user supplies data
 * (and the SDK calls `loadSet()` to release the gate).
 */

import type { MediaObject, OQSEItem, OQSEMeta, ProgressRecord } from '@memizy/oqse';
import {
  safeValidateOQSEFile,
  safeValidateOQSEItem,
  safeValidateOQSEProgress,
} from '@memizy/oqse';
import { apply } from 'mutative';
import type { Patches } from 'mutative';
import type {
  AssetUploadRequest,
  ExitOptions,
  HostApi,
  InitSessionPayload,
  JsonPatches,
  PluginErrorReport,
  PluginIdentity,
  ResizeRequest,
  SessionSettings,
} from '../rpc/types';

const STORAGE_KEY = 'memizy.plugin-sdk.standalone.v0.3';

/** Seed data a plugin can pass to `sdk.connect({ mockData })`. */
export interface StandaloneMockData {
  items?: OQSEItem[];
  assets?: Record<string, MediaObject>;
  setMeta?: OQSEMeta;
  settings?: Partial<SessionSettings>;
  progress?: Record<string, ProgressRecord>;
}

interface PersistedState {
  items: OQSEItem[];
  meta?: OQSEMeta;
  progress: Record<string, ProgressRecord>;
  assets: Record<string, MediaObject>;
}

/**
 * An in-memory `HostApi` implementation backed by `sessionStorage`.
 *
 * The SDK passes this directly to the managers — they only care about
 * conforming to `HostApi`, not where it's implemented.
 */
export class MockHost implements HostApi {
  private state: PersistedState;
  private readonly rawAssets = new Map<string, File | Blob>();
  private readonly debug: boolean;

  /** When set, `sysInit()` will await the promise before resolving. */
  private pendingInit: {
    promise: Promise<void>;
    resolve: () => void;
  } | null = null;

  constructor(seed: StandaloneMockData = {}, debug = false) {
    this.debug = debug;
    this.state = this.loadOrSeed(seed);
  }

  // ── HostApi — system ────────────────────────────────────────────────────

  async sysInit(identity: PluginIdentity): Promise<InitSessionPayload> {
    this.log(`sysInit ← ${identity.id}@${identity.version}`);
    if (this.pendingInit) {
      this.log('sysInit is waiting for user to load a study set…');
      await this.pendingInit.promise;
    }
    return {
      sessionId: `standalone-${Date.now()}`,
      items: [...this.state.items],
      assets: { ...this.state.assets },
      setMeta: this.state.meta,
      settings: { locale: defaultLocale(), theme: 'light' },
      progress: { ...this.state.progress },
    };
  }

  async sysExit(options: ExitOptions): Promise<void> {
    this.log('sysExit', options);
  }

  async sysRequestResize(request: ResizeRequest): Promise<void> {
    this.log('sysRequestResize', request);
  }

  async sysReportError(error: PluginErrorReport): Promise<void> {
    console.warn('[memizy-plugin-sdk/standalone] plugin error:', error);
  }

  // ── HostApi — store ─────────────────────────────────────────────────────

  async storeSyncProgress(
    records: Record<string, ProgressRecord>,
  ): Promise<void> {
    Object.assign(this.state.progress, records);
    this.persist();
  }

  async storeApplyItemPatches(patches: JsonPatches): Promise<void> {
    this.state.items = apply(this.state.items, patches as Patches) as OQSEItem[];
    this.persist();
  }

  async storeApplyMetaPatches(patches: JsonPatches): Promise<void> {
    const base = this.state.meta ?? ({} as OQSEMeta);
    this.state.meta = apply(base, patches as Patches) as OQSEMeta;
    this.persist();
  }

  // ── HostApi — assets ────────────────────────────────────────────────────

  async assetUpload(request: AssetUploadRequest): Promise<MediaObject> {
    const key =
      request.suggestedKey ??
      (request.file instanceof File
        ? request.file.name
        : `asset-${Date.now().toString(36)}`);

    this.rawAssets.set(key, request.file);
    const media: MediaObject = {
      type: inferMediaType(request.file),
      value: URL.createObjectURL(request.file),
      mimeType: request.file.type || 'application/octet-stream',
    };
    this.state.assets[key] = media;
    this.persist();
    return media;
  }

  async assetGetRaw(key: string): Promise<File | Blob> {
    const raw = this.rawAssets.get(key);
    if (!raw) {
      throw new Error(`[memizy-plugin-sdk/standalone] No raw asset for key "${key}"`);
    }
    return raw;
  }

  // ── Standalone-only extensions (used by the SDK / Standalone UI) ────────

  /** `true` if the mock already has a loaded study set to serve. */
  hasStudySet(): boolean {
    return this.state.items.length > 0;
  }

  /** Count of progress records currently held in the mock state. */
  getProgressCount(): number {
    return Object.keys(this.state.progress).length;
  }

  /**
   * Arm the pending-init gate. The next `sysInit()` call will block until
   * `loadSet()` is invoked. No-op if a gate is already armed.
   */
  markPendingInit(): void {
    if (this.pendingInit) return;
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    this.pendingInit = { promise, resolve };
  }

  /**
   * Replace the mock state with a new study set. Also releases a pending
   * `sysInit()` if one is armed.
   */
  loadSet(
    items: OQSEItem[],
    options: { meta?: OQSEMeta; assets?: Record<string, MediaObject> } = {},
  ): void {
    this.state.items = [...items];
    if (options.meta) this.state.meta = options.meta;
    if (options.assets) this.state.assets = { ...options.assets };
    this.persist();
    if (this.pendingInit) {
      this.pendingInit.resolve();
      this.pendingInit = null;
    }
  }

  /** Merge a batch of progress records into the mock state. */
  loadProgress(records: Record<string, ProgressRecord>): void {
    Object.assign(this.state.progress, records);
    this.persist();
  }

  /**
   * Parse + validate a raw OQSE JSON string and atomically load it.
   *
   * Accepts three shapes, in order of preference:
   *   1. A full OQSE file `{ version, meta, items }`
   *   2. A partial `{ items: OQSEItem[], meta?, assets? }`
   *   3. A bare `OQSEItem[]`
   *
   * Throws an `Error` with a human-readable message on any failure.
   */
  loadSetFromJson(jsonText: string): void {
    let raw: unknown;
    try {
      raw = JSON.parse(jsonText);
    } catch (err) {
      throw new Error(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 1. Full OQSE file?
    const asFile = safeValidateOQSEFile(raw);
    if (asFile.success && asFile.data) {
      const file = asFile.data;
      this.loadSet(file.items, {
        meta: file.meta,
        assets: file.meta?.assets,
      });
      return;
    }

    // 2. Envelope `{ items, meta?, assets? }`
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'items' in raw) {
      const env = raw as { items: unknown; meta?: OQSEMeta; assets?: Record<string, MediaObject> };
      const items = coerceItems(env.items);
      this.loadSet(items, { meta: env.meta, assets: env.assets });
      return;
    }

    // 3. Bare array
    if (Array.isArray(raw)) {
      this.loadSet(coerceItems(raw));
      return;
    }

    throw new Error('Unrecognised OQSE payload shape (expected a file, envelope, or item array).');
  }

  /**
   * Parse + validate a raw OQSEP JSON string and merge its records into
   * the mock state.
   */
  loadProgressFromJson(jsonText: string): void {
    let raw: unknown;
    try {
      raw = JSON.parse(jsonText);
    } catch (err) {
      throw new Error(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }

    const result = safeValidateOQSEProgress(raw);
    if (!result.success || !result.data) {
      throw new Error(`Invalid OQSEP payload: ${flattenZod(result.error)}`);
    }
    this.loadProgress(result.data.records);
  }

  // ── Persistence ─────────────────────────────────────────────────────────

  private loadOrSeed(seed: StandaloneMockData): PersistedState {
    const persisted = this.tryRestore();
    if (persisted && persisted.items.length > 0) return persisted;

    return {
      items: seed.items ? [...seed.items] : [],
      meta: seed.setMeta,
      progress: seed.progress ? { ...seed.progress } : {},
      assets: seed.assets ? { ...seed.assets } : {},
    };
  }

  private tryRestore(): PersistedState | null {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      if (!Array.isArray(parsed.items)) return null;
      return {
        items: parsed.items,
        meta: parsed.meta,
        progress: parsed.progress ?? {},
        assets: parsed.assets ?? {},
      };
    } catch {
      return null;
    }
  }

  private persist(): void {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Quota / privacy mode — safe to ignore in dev.
    }
  }

  private log(...args: unknown[]): void {
    if (this.debug) console.log('[memizy-plugin-sdk/standalone]', ...args);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function coerceItems(raw: unknown): OQSEItem[] {
  if (!Array.isArray(raw)) {
    throw new Error('Expected an array of OQSE items.');
  }
  const items: OQSEItem[] = [];
  raw.forEach((entry, idx) => {
    const result = safeValidateOQSEItem(entry);
    if (!result.success || !result.data) {
      throw new Error(`Item #${idx} failed validation: ${flattenZod(result.error)}`);
    }
    items.push(result.data);
  });
  return items;
}

function flattenZod(err: { issues: { path: (string | number)[]; message: string }[] } | unknown): string {
  const issues = (err as { issues?: { path: (string | number)[]; message: string }[] }).issues;
  if (!Array.isArray(issues) || issues.length === 0) return 'validation failed';
  const top = issues[0]!;
  const path = top.path.join('.') || '<root>';
  const more = issues.length > 1 ? ` (+${issues.length - 1} more)` : '';
  return `${path}: ${top.message}${more}`;
}

function inferMediaType(file: File | Blob): MediaObject['type'] {
  const mime = file.type || '';
  if (mime.startsWith('audio')) return 'audio';
  if (mime.startsWith('video')) return 'video';
  if (mime.includes('gltf') || mime.includes('glb') || mime.startsWith('model'))
    return 'model';
  return 'image';
}

function defaultLocale(): string {
  try {
    return navigator.language.split('-')[0] ?? 'en';
  } catch {
    return 'en';
  }
}
