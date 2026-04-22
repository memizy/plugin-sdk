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
 */

import type { MediaObject, OQSEItem, OQSEMeta, ProgressRecord } from '@memizy/oqse';
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
 * The SDK wraps this instance in a Penpal-like `RemoteProxy<HostApi>` cast
 * so the manager classes are completely agnostic to whether they are
 * talking to a real host or this mock.
 */
export class MockHost implements HostApi {
  private state: PersistedState;
  private readonly rawAssets = new Map<string, File | Blob>();
  private readonly debug: boolean;

  constructor(seed: StandaloneMockData = {}, debug = false) {
    this.debug = debug;
    this.state = this.loadOrSeed(seed);
  }

  // ── HostApi — system ────────────────────────────────────────────────────

  async sysInit(identity: PluginIdentity): Promise<InitSessionPayload> {
    this.log(`sysInit ← ${identity.id}@${identity.version}`);
    return {
      sessionId: `standalone-${Date.now()}`,
      items: [...this.state.items],
      assets: { ...this.state.assets },
      setMeta: this.state.meta,
      settings: {
        locale: defaultLocale(),
        theme: 'light',
      },
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
    this.state.items = applyPatches(this.state.items, patches) as OQSEItem[];
    this.persist();
  }

  async storeApplyMetaPatches(patches: JsonPatches): Promise<void> {
    const base = this.state.meta ?? ({} as OQSEMeta);
    this.state.meta = applyPatches(base, patches) as OQSEMeta;
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

  // ── Persistence ─────────────────────────────────────────────────────────

  private loadOrSeed(seed: StandaloneMockData): PersistedState {
    const persisted = this.tryRestore();
    if (persisted && persisted.items.length > 0) {
      return persisted;
    }
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

/**
 * Minimal JSON-patch applier compatible with mutative's default output
 * (`pathAsArray: true`). Only supports the ops mutative actually emits:
 * `add`, `remove`, `replace`.
 *
 * Returns a structurally fresh copy so the host never mutates its input.
 */
function applyPatches<T>(base: T, patches: JsonPatches): T {
  const next: unknown = structuredCloneSafe(base);
  for (const patch of patches) {
    applyPatch(next, patch.path, patch.op, patch.value);
  }
  return next as T;
}

function applyPatch(
  root: unknown,
  path: (string | number)[],
  op: 'add' | 'remove' | 'replace',
  value: unknown,
): void {
  if (path.length === 0) return;
  const parent = navigate(root, path.slice(0, -1));
  const key = path[path.length - 1]!;

  if (Array.isArray(parent)) {
    const index = typeof key === 'number' ? key : Number(key);
    if (op === 'add') parent.splice(index, 0, value);
    else if (op === 'remove') parent.splice(index, 1);
    else parent[index] = value;
    return;
  }
  if (parent && typeof parent === 'object') {
    const record = parent as Record<string, unknown>;
    const stringKey = String(key);
    if (op === 'remove') delete record[stringKey];
    else record[stringKey] = value;
  }
}

function navigate(root: unknown, path: (string | number)[]): unknown {
  let cursor: unknown = root;
  for (const key of path) {
    if (cursor == null) return cursor;
    cursor = (cursor as Record<string | number, unknown>)[key as never];
  }
  return cursor;
}

function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // Fall through to JSON clone for non-cloneable structures.
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
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
