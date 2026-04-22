/**
 * `plugin.store` — state-sync & CRUD for items, meta, and progress.
 *
 * Item and meta mutations are expressed as recipe callbacks (mutative):
 *
 *   plugin.store.updateItem(id, (item) => { item.title = 'new'; });
 *
 * Only the resulting JSON patches are sent across the RPC boundary — never
 * the entire array — which keeps host↔iframe traffic proportional to the
 * delta.
 */

import type {
  LastAnswerObject,
  OQSEItem,
  OQSEMeta,
  ProgressRecord,
  StatsObject,
} from '@memizy/oqse';
import { create, type Patches } from 'mutative';

import { ItemTimerManager } from '../core/ItemTimerManager';
import { defaultLeitnerReducer } from '../core/leitner';
import type {
  AnswerOptions,
  Bucket,
  HostApi,
  JsonPatches,
} from '../rpc/types';

/** Internal snapshot the SDK keeps in lock-step with the host. */
interface StoreSnapshot {
  items: OQSEItem[];
  meta: OQSEMeta | undefined;
  progress: Record<string, ProgressRecord>;
}

/** Recipe callback used by `updateItem` / `createItem` / `updateMeta`. */
export type ItemRecipe = (draft: OQSEItem) => void;
export type MetaRecipe = (draft: OQSEMeta) => void;

export class StoreManager {
  private readonly host: HostApi;
  private readonly timers = new ItemTimerManager();
  private snapshot: StoreSnapshot;

  constructor(host: HostApi, initial: StoreSnapshot) {
    this.host = host;
    this.snapshot = {
      items: [...initial.items],
      meta: initial.meta,
      progress: { ...initial.progress },
    };
  }

  /**
   * Hot-swap the internal snapshot — used by the SDK when a new study set
   * is loaded mid-session (e.g. via the Standalone UI modal). Existing
   * per-item timers are discarded so the new set starts from a clean slate.
   *
   * @internal — not part of the stable plugin API.
   */
  _updateSnapshot(initial: StoreSnapshot): void {
    this.timers.clearAll();
    this.snapshot = {
      items: [...initial.items],
      meta: initial.meta,
      progress: { ...initial.progress },
    };
  }

  // ── Snapshot accessors ──────────────────────────────────────────────────

  /** A shallow copy of the current items array. */
  getItems(): OQSEItem[] {
    return [...this.snapshot.items];
  }

  /** The currently loaded study-set metadata, if any. */
  getMeta(): OQSEMeta | undefined {
    return this.snapshot.meta;
  }

  /** A shallow copy of the current progress records. */
  getProgress(): Record<string, ProgressRecord> {
    return { ...this.snapshot.progress };
  }

  /** Lookup a single item by id. */
  getItem(itemId: string): OQSEItem | undefined {
    return this.snapshot.items.find((it) => it.id === itemId);
  }

  // ── Progress / Leitner (state-sync) ─────────────────────────────────────

  /**
   * Record an answer for an item:
   *   1. Resolve `timeSpent` from the per-item timer if not supplied.
   *   2. Run the Leitner reducer to compute the new `ProgressRecord`.
   *   3. Push the updated record to the host via `storeSyncProgress`.
   */
  answer(
    itemId: string,
    isCorrect: boolean,
    options: AnswerOptions = {},
  ): ProgressRecord {
    const timeSpent = this.resolveTimeSpent(itemId, options);
    const next = defaultLeitnerReducer(
      this.snapshot.progress[itemId],
      isCorrect,
      timeSpent,
      options,
    );
    this.snapshot.progress[itemId] = next;
    void this.host.storeSyncProgress({ [itemId]: next });
    return next;
  }

  /**
   * Record a skip: bucket/stats are untouched, only `lastAnswer` is updated
   * with `isSkipped: true`. Pushes the delta to the host.
   */
  skip(itemId: string): ProgressRecord {
    const timeSpent = this.timers.has(itemId) ? this.timers.stop(itemId) : 0;
    const base: ProgressRecord = this.snapshot.progress[itemId] ?? {
      bucket: 0 as Bucket,
      stats: { attempts: 0, incorrect: 0, streak: 0 } as StatsObject,
    };
    const lastAnswer: LastAnswerObject = {
      isCorrect: false,
      answeredAt: new Date().toISOString(),
      timeSpent,
      hintsUsed: 0,
      isSkipped: true,
    };
    const next: ProgressRecord = { ...base, lastAnswer };
    this.snapshot.progress[itemId] = next;
    void this.host.storeSyncProgress({ [itemId]: next });
    return next;
  }

  /**
   * Bulk-merge external progress records into the local snapshot and push
   * them to the host in a single RPC call.
   */
  async syncProgress(
    records: Record<string, ProgressRecord>,
  ): Promise<void> {
    Object.assign(this.snapshot.progress, records);
    await this.host.storeSyncProgress(records);
  }

  // ── Patch-based item mutations ──────────────────────────────────────────

  /**
   * Mutate an existing item using a mutative recipe. The generated JSON
   * patches are scoped to the target item (path prefixed with the item's
   * array index) so the host can apply them without re-serialising the
   * entire items array.
   *
   * @returns the freshly mutated item, or `undefined` if no such id.
   */
  async updateItem(
    itemId: string,
    recipe: ItemRecipe,
  ): Promise<OQSEItem | undefined> {
    const index = this.snapshot.items.findIndex((it) => it.id === itemId);
    if (index === -1) return undefined;

    const [nextItems, patches] = create(
      this.snapshot.items,
      (draft) => {
        recipe(draft[index]!);
      },
      { enablePatches: true },
    );

    if (patches.length === 0) return this.snapshot.items[index];
    this.snapshot.items = nextItems;
    await this.host.storeApplyItemPatches(toJsonPatches(patches));
    return this.snapshot.items[index];
  }

  /**
   * Append (or upsert by id) a new item. Emits an `add` patch at the array
   * tail, or a `replace` patch when an item with the same id exists.
   */
  async createItem(item: OQSEItem): Promise<OQSEItem> {
    const existingIndex = this.snapshot.items.findIndex(
      (it) => it.id === item.id,
    );

    const [nextItems, patches] = create(
      this.snapshot.items,
      (draft) => {
        if (existingIndex === -1) draft.push(item);
        else draft[existingIndex] = item;
      },
      { enablePatches: true },
    );

    this.snapshot.items = nextItems;
    await this.host.storeApplyItemPatches(toJsonPatches(patches));
    return item;
  }

  /**
   * Remove an item by id. Silently no-ops when the id is unknown.
   * @returns `true` if an item was actually deleted.
   */
  async deleteItem(itemId: string): Promise<boolean> {
    const index = this.snapshot.items.findIndex((it) => it.id === itemId);
    if (index === -1) return false;

    const [nextItems, patches] = create(
      this.snapshot.items,
      (draft) => {
        draft.splice(index, 1);
      },
      { enablePatches: true },
    );

    this.snapshot.items = nextItems;
    await this.host.storeApplyItemPatches(toJsonPatches(patches));
    return true;
  }

  // ── Patch-based meta mutations ──────────────────────────────────────────

  /**
   * Mutate the study-set metadata via a mutative recipe. JSON patches
   * are forwarded to `storeApplyMetaPatches`.
   *
   * If no meta is currently loaded, an empty meta object is seeded before
   * applying the recipe so the plugin can bootstrap fields.
   */
  async updateMeta(recipe: MetaRecipe): Promise<OQSEMeta | undefined> {
    const base = (this.snapshot.meta ?? {}) as OQSEMeta;

    const [nextMeta, patches] = create(
      base,
      (draft) => {
        recipe(draft);
      },
      { enablePatches: true },
    );

    if (patches.length === 0) return this.snapshot.meta;
    this.snapshot.meta = nextMeta;
    await this.host.storeApplyMetaPatches(toJsonPatches(patches));
    return this.snapshot.meta;
  }

  // ── Timers ──────────────────────────────────────────────────────────────

  /**
   * Start a per-item stopwatch. Call this when the item becomes visible;
   * `answer()` / `skip()` will pick up the elapsed time automatically.
   */
  startItemTimer(itemId: string): void {
    this.timers.start(itemId);
  }

  /** Stop the timer for `itemId` and return elapsed milliseconds. */
  stopItemTimer(itemId: string): number {
    return this.timers.stop(itemId);
  }

  /** Discard a running timer without consuming it. */
  clearItemTimer(itemId: string): void {
    this.timers.clear(itemId);
  }

  /** Used by the SDK lifecycle on abort/destroy. */
  /** @internal */
  _clearAllTimers(): void {
    this.timers.clearAll();
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private resolveTimeSpent(itemId: string, options: AnswerOptions): number {
    if (options.timeSpent !== undefined) {
      if (this.timers.has(itemId)) this.timers.clear(itemId);
      return options.timeSpent;
    }
    return this.timers.has(itemId) ? this.timers.stop(itemId) : 0;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalise mutative's `Patches` to the wire-format declared in the RPC
 * contract (`JsonPatches`). With default options mutative already emits
 * `path: (string | number)[]`, but we cast explicitly to make the boundary
 * type-safe from the host's perspective.
 */
function toJsonPatches(patches: Patches): JsonPatches {
  return patches.map((p) => ({
    op: p.op,
    path: p.path as (string | number)[],
    ...(('value' in p ? { value: p.value } : {}) as { value?: unknown }),
  }));
}
