/**
 * StandaloneStorage — zero-dependency IndexedDB wrapper for Standalone Mode.
 *
 * Database: MemizyStandaloneDB  v1
 * Stores:
 *   set_data      — key "items" → OQSEItem[], key "meta" → OQSEMeta
 *   progress_data — key "records" → Record<string, ProgressRecord>
 *   assets_data   — key = asset_key (string) → File | Blob
 */

import type { OQSEItem, OQSEMeta } from '../types/oqse';
import type { ProgressRecord } from '../types/oqsep';

const DB_NAME      = 'MemizyStandaloneDB';
const DB_VERSION   = 1;
const STORE_SET      = 'set_data';
const STORE_PROGRESS = 'progress_data';
const STORE_ASSETS   = 'assets_data';

// ── IndexedDB micro-helpers ──────────────────────────────────────────────────

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function idbTx(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(new Error('IDBTransaction aborted'));
  });
}

// ── StandaloneStorage ────────────────────────────────────────────────────────

export class StandaloneStorage {
  private db: IDBDatabase | null = null;

  /**
   * Open (or create) the IndexedDB database.
   * Must be called before any other method.
   */
  init(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_SET))      db.createObjectStore(STORE_SET);
        if (!db.objectStoreNames.contains(STORE_PROGRESS)) db.createObjectStore(STORE_PROGRESS);
        if (!db.objectStoreNames.contains(STORE_ASSETS))   db.createObjectStore(STORE_ASSETS);
      };

      req.onsuccess = () => { this.db = req.result; resolve(); };
      req.onerror   = () => reject(req.error);
    });
  }

  private get idb(): IDBDatabase {
    if (!this.db) throw new Error('StandaloneStorage: call init() before use');
    return this.db;
  }

  // ── Set data ─────────────────────────────────────────────────────────────

  /**
   * Returns the saved study set, or `null` if no set has been stored yet.
   */
  async getSet(): Promise<{ items: OQSEItem[]; meta: OQSEMeta } | null> {
    const tx    = this.idb.transaction(STORE_SET, 'readonly');
    const store = tx.objectStore(STORE_SET);
    const [items, meta] = await Promise.all([
      idbRequest<OQSEItem[] | undefined>(store.get('items')),
      idbRequest<OQSEMeta   | undefined>(store.get('meta')),
    ]);
    if (!items || !meta) return null;
    return { items, meta };
  }

  /**
   * Merge incoming items into the persisted `"items"` array (merge by `id`).
   */
  async saveItems(incoming: OQSEItem[]): Promise<void> {
    const tx    = this.idb.transaction(STORE_SET, 'readwrite');
    const store = tx.objectStore(STORE_SET);
    const existing = await idbRequest<OQSEItem[] | undefined>(store.get('items')) ?? [];
    const map = new Map(existing.map(it => [it['id'] as string, it]));
    for (const item of incoming) map.set(item['id'] as string, item);
    store.put([...map.values()], 'items');
    return idbTx(tx);
  }

  /**
   * Remove items from the persisted `"items"` array by their UUIDs.
   */
  async deleteItems(itemIds: string[]): Promise<void> {
    const tx    = this.idb.transaction(STORE_SET, 'readwrite');
    const store = tx.objectStore(STORE_SET);
    const existing = await idbRequest<OQSEItem[] | undefined>(store.get('items')) ?? [];
    const toDelete = new Set(itemIds);
    store.put(existing.filter(it => !toDelete.has(it['id'] as string)), 'items');
    return idbTx(tx);
  }

  /**
   * Merge partial meta fields into the persisted `"meta"` object.
   */
  async updateMeta(incoming: Partial<OQSEMeta>): Promise<void> {
    const tx    = this.idb.transaction(STORE_SET, 'readwrite');
    const store = tx.objectStore(STORE_SET);
    const existing = await idbRequest<OQSEMeta | undefined>(store.get('meta')) ?? {} as OQSEMeta;
    store.put({ ...existing, ...incoming }, 'meta');
    return idbTx(tx);
  }

  // ── Progress data ─────────────────────────────────────────────────────────

  /**
   * Returns all persisted `ProgressRecord` entries, or `null` if none saved.
   */
  async getProgress(): Promise<Record<string, ProgressRecord> | null> {
    const tx     = this.idb.transaction(STORE_PROGRESS, 'readonly');
    const result = await idbRequest<Record<string, ProgressRecord> | undefined>(
      tx.objectStore(STORE_PROGRESS).get('records'),
    );
    return result ?? null;
  }

  /**
   * Merge incoming records into the persisted `"records"` map.
   */
  async saveProgress(records: Record<string, ProgressRecord>): Promise<void> {
    const tx    = this.idb.transaction(STORE_PROGRESS, 'readwrite');
    const store = tx.objectStore(STORE_PROGRESS);
    const existing = await idbRequest<Record<string, ProgressRecord> | undefined>(
      store.get('records'),
    ) ?? {};
    store.put({ ...existing, ...records }, 'records');
    return idbTx(tx);
  }

  // ── Asset data ────────────────────────────────────────────────────────────

  /** Persist a binary asset under the given logical key. */
  saveAsset(key: string, file: File | Blob): Promise<void> {
    const tx = this.idb.transaction(STORE_ASSETS, 'readwrite');
    tx.objectStore(STORE_ASSETS).put(file, key);
    return idbTx(tx);
  }

  /** Retrieve a binary asset by its logical key. Throws if not found. */
  async getAsset(key: string): Promise<File | Blob> {
    const tx     = this.idb.transaction(STORE_ASSETS, 'readonly');
    const result = await idbRequest<File | Blob | undefined>(
      tx.objectStore(STORE_ASSETS).get(key),
    );
    if (result === undefined) throw new Error(`StandaloneStorage: asset "${key}" not found`);
    return result;
  }

  // ── Reset ─────────────────────────────────────────────────────────────────

  /** Wipe all data across all three stores. */
  clearAll(): Promise<void> {
    const tx = this.idb.transaction([STORE_SET, STORE_PROGRESS, STORE_ASSETS], 'readwrite');
    tx.objectStore(STORE_SET).clear();
    tx.objectStore(STORE_PROGRESS).clear();
    tx.objectStore(STORE_ASSETS).clear();
    return idbTx(tx);
  }
}
