# Memizy Plugin Host Protocol v0.3

> Audience: developers building a **Memizy host** (e.g. the Vue Player, a CMS
> preview, or a custom LMS integration) that embeds third-party plugins.
>
> Plugin authors do not need to read this document — see
> [`plugin-api.md`](./plugin-api.md) instead.

This document specifies the RPC contract the host must implement to talk to
plugins that use `@memizy/plugin-sdk ≥ 0.3.4`.

It is intentionally framework-agnostic: you can implement it with any
Penpal v7 integration, in Vue, React, Svelte, or vanilla TS.

---

## 1. Overview

The host mounts the plugin in an `<iframe>` and establishes a bidirectional
RPC channel over `postMessage` using [Penpal v7](https://github.com/Aaronius/penpal).

```
 ┌──────────────────┐                               ┌──────────────────┐
 │ Memizy Host      │ ──── HostApi (Plugin→Host) ─▶ │ Plugin <iframe>  │
 │ (Vue/React/…)    │                               │ @memizy/plugin-  │
 │                  │ ◀── PluginApi (Host→Plugin) ─ │ sdk v0.3.4+      │
 └──────────────────┘                               └──────────────────┘
```

Two contracts govern the channel:

- **`HostApi`** — methods the **host** exposes to the plugin
  (the plugin calls `host.sysInit(…)`, `host.storeApplyItemPatches(…)`, etc.).
- **`PluginApi`** — methods the **plugin** exposes to the host
  (the host calls `plugin.onConfigUpdate(…)`, `plugin.onSessionAborted(…)`).

Both interfaces are exported from `@memizy/plugin-sdk`:

```ts
import type { HostApi, PluginApi } from '@memizy/plugin-sdk';
```

All methods are `async` (return `Promise<T>`), which is what Penpal expects.

---

## 2. `HostApi` — what the host must implement

Below is the shape, grouped by namespace. All payload types are re-exported
from `@memizy/plugin-sdk`, which in turn re-exports them from `@memizy/oqse`.

```ts
export interface HostApi {
  // System ----------------------------------------------------------------
  sysInit(identity: PluginIdentity): Promise<InitSessionPayload>;
  sysExit(options: ExitOptions): Promise<void>;
  sysRequestResize(request: ResizeRequest): Promise<void>;
  sysReportError(error: PluginErrorReport): Promise<void>;

  // Store -----------------------------------------------------------------
  storeSyncProgress(records: Record<string, ProgressRecord>): Promise<void>;
  storeApplyItemPatches(patches: JsonPatches): Promise<void>;
  storeApplyMetaPatches(patches: JsonPatches): Promise<void>;

  // Assets ----------------------------------------------------------------
  assetUpload(request: AssetUploadRequest): Promise<MediaObject>;
  assetGetRaw(key: string): Promise<File | Blob>;
}
```

### 2.1 `sys*` — lifecycle

| Method              | Purpose |
|---------------------|---------|
| `sysInit`           | **Called once** by the plugin after the Penpal handshake. Returns the initial session payload (items, assets, meta, settings, progress). Think of it as "give me everything I need to render". |
| `sysExit`           | Signals session end. Host should tear down the iframe, optionally store the `score`. |
| `sysRequestResize`  | Hint from the plugin ("my content is 720px tall"). Host MAY honour it or clamp to its own layout constraints. |
| `sysReportError`    | Non-fatal plugin error for telemetry / devtools. Host MUST NOT tear down the session in response. |

### 2.2 `store*` — state sync

These methods are how **all** state changes flow out of the plugin.

| Method                   | Payload | Use |
|--------------------------|---------|-----|
| `storeSyncProgress`      | `Record<itemId, ProgressRecord>` | Leitner bucket / stats / last-answer updates. |
| `storeApplyItemPatches`  | `JsonPatches` (mutative)         | Targeted delta edits to the `items` array. |
| `storeApplyMetaPatches`  | `JsonPatches` (mutative)         | Targeted delta edits to the study-set metadata. |

> **Patches, not full arrays.** The SDK never sends you the whole `items`
> array on a mutation — only the delta. This keeps bandwidth proportional
> to the edit and avoids lost-update races. See [§3](#3-handling-json-patches).

### 2.3 `asset*` — binary bridge

Penpal v7 transfers `File` / `Blob` instances using the browser's structured
clone algorithm. No base64, no manual chunking.

| Method          | Flow |
|-----------------|------|
| `assetUpload`   | Plugin hands you a `File`/`Blob` + optional `suggestedKey`. Host stores it (S3, IndexedDB, disk, …) and returns a fully-hydrated `MediaObject` (url, mime, subtitles, …). |
| `assetGetRaw`   | Plugin asks for the raw binary by key. Host resolves to a `File` or `Blob`. |

---

## 3. `PluginApi` — what the host calls on the plugin

The host obtains a remote proxy during the Penpal handshake and can push
events to the plugin:

```ts
export interface PluginApi {
  onConfigUpdate(config: ConfigUpdate): Promise<void>;
  onSessionAborted(reason: SessionAbortedReason): Promise<void>;
}
```

| Method              | Use |
|---------------------|-----|
| `onConfigUpdate`    | Theme / locale changed mid-session. Send partial settings (`{ theme: 'dark' }`). The plugin MUST reapply styles. |
| `onSessionAborted`  | You killed the session from the host (e.g. user navigated away, timeout, host error). Plugin stops timers and blocks further RPCs. |

---

## 4. Handling JSON Patches

Both `storeApplyItemPatches` and `storeApplyMetaPatches` receive a
`JsonPatches` array:

```ts
interface JsonPatch {
  op: 'add' | 'remove' | 'replace';
  path: (string | number)[];
  value?: unknown;
}
type JsonPatches = JsonPatch[];
```

These are produced by [mutative](https://github.com/unadlib/mutative) with
`enablePatches: true` and **default settings**, so paths are always arrays
(never `'/foo/0'` JSON-Pointer strings).

### 4.1 Applying patches on the host

You have two equally valid approaches:

**A. Use mutative on the host** (recommended — round-trip safe):

```ts
import { apply } from 'mutative';

host.storeApplyItemPatches = async (patches) => {
  const current = await db.getItems(setId);
  const next = apply(current, patches);
  await persistValidatedItems(setId, next); // ← see §5
};
```

**B. Implement your own JSON-patch applier** (smaller dependency surface).
Only three operations occur; paths are `(string | number)[]`. The SDK's
`MockHost` contains a ~30-line reference implementation you can copy.

### 4.2 Applying meta patches

Metadata starts as `undefined` when a brand-new set is being built. If your
plugin calls `sdk.store.updateMeta(draft => { draft.title = 'X'; })` on an
empty state, the first patch will have `path: ['title']` at the root. Seed
an empty meta object before applying:

```ts
host.storeApplyMetaPatches = async (patches) => {
  const current = (await db.getMeta(setId)) ?? ({} as OQSEMeta);
  const next = apply(current, patches);
  await persistValidatedMeta(setId, next); // ← see §5
};
```

---

## 5. 🚨 **CRITICAL: Validate with `@memizy/oqse` Zod schemas**

Plugins run sandboxed in an iframe but they are still **untrusted input**
from the host's perspective:

- The plugin could be buggy and send malformed JSON patches.
- A rogue plugin author could emit deliberately corrupt data.
- Browser extensions can tamper with `postMessage` traffic.

**The host MUST re-validate every mutation before committing it to the
database.**

`@memizy/oqse` ships Zod schemas for every OQSE shape. Use them:

```ts
import {
  OQSEItemSchema,
  OQSEMetaSchema,
  ProgressRecordSchema,
  safeValidateOQSEItem,
} from '@memizy/oqse';
import { apply } from 'mutative';

host.storeApplyItemPatches = async (patches) => {
  const current = await db.getItems(setId);
  const next = apply(current, patches);

  // 1. Validate every item in the resulting array.
  const validated = next.map((item, idx) => {
    const r = safeValidateOQSEItem(item);
    if (!r.success || !r.data) {
      throw new HostRejection(
        `Plugin patch produced an invalid item at index ${idx}`,
        { zod: r.error, itemId: (item as { id?: string }).id },
      );
    }
    return r.data;
  });

  // 2. Only now write to the database.
  await db.writeItems(setId, validated);
};

host.storeSyncProgress = async (records) => {
  // Whitelist known item ids; validate each record.
  for (const [id, rec] of Object.entries(records)) {
    const r = ProgressRecordSchema.safeParse(rec);
    if (!r.success) throw new HostRejection(`Invalid progress for ${id}`);
  }
  await db.writeProgress(records);
};
```

### 5.1 Why this matters

| Without host-side validation                                | With host-side validation |
|--------------------------------------------------------------|----------------------------|
| A plugin bug that writes `bucket: 'high'` silently corrupts the DB. | The rejection surfaces immediately and nothing is persisted. |
| A stale item schema from an old plugin build becomes gospel. | The host enforces the current schema version. |
| One bad item poisons the entire study set after re-load.      | Invalid items never reach storage. |

### 5.2 Error handling strategy

When validation fails, the host has three reasonable options:

1. **Reject the RPC** — throw from the handler. Penpal will forward the
   rejection to the plugin, which should catch it and call
   `sys.reportError(...)`.
2. **Log + drop** — silently ignore invalid records but keep the session
   alive. Useful during schema migrations.
3. **Quarantine** — persist to a "rejected" store for later inspection.

Whichever you choose, **never write unvalidated patch output to your
authoritative database.**

---

## 6. Returning the `InitSessionPayload`

`sysInit` is the one call the plugin always makes first. Return **exactly**
what it needs — no more, no less:

```ts
interface InitSessionPayload {
  sessionId: string;                           // opaque to the plugin
  items: OQSEItem[];                           // validated!
  assets: Record<string, MediaObject>;         // url-ready, no raw blobs
  setMeta?: OQSEMeta;                          // optional but recommended
  settings: SessionSettings;                   // { locale, theme }
  progress?: Record<string, ProgressRecord>;   // Leitner state, per item id
}
```

Guidance:

- **Resolve `MediaObject.value` to something the iframe can fetch.**
  Signed S3 URLs, `blob:` URLs, or `data:` URIs are all fine.
- **`progress`** is optional. If omitted, the plugin treats every item as
  brand-new (bucket 0).
- **`settings.theme`** can be `'system'` — the plugin will resolve it
  against `prefers-color-scheme` if you don't have explicit user preference.

---

## 7. Reference handshake (vanilla TS)

```ts
import { WindowMessenger, connect } from 'penpal';
import type { HostApi, PluginApi } from '@memizy/plugin-sdk';
import {
  safeValidateOQSEItem,
  ProgressRecordSchema,
} from '@memizy/oqse';
import { apply } from 'mutative';

function mountPlugin(iframe: HTMLIFrameElement, setId: string) {
  const messenger = new WindowMessenger({
    remoteWindow: iframe.contentWindow!,
    allowedOrigins: [iframe.src],
  });

  const hostApi: HostApi = {
    async sysInit(identity) {
      console.log(`[host] plugin ${identity.id}@${identity.version} connected`);
      return db.loadSession(setId);
    },
    async sysExit(options) { await db.saveScore(setId, options.score); },
    async sysRequestResize({ height }) { iframe.style.height = toPx(height); },
    async sysReportError(err) { telemetry.report(err); },

    async storeSyncProgress(records) {
      for (const [id, rec] of Object.entries(records)) {
        const r = ProgressRecordSchema.safeParse(rec);
        if (!r.success) throw new Error('invalid progress');
      }
      await db.writeProgress(setId, records);
    },
    async storeApplyItemPatches(patches) {
      const current = await db.getItems(setId);
      const next = apply(current, patches).map((it, i) => {
        const r = safeValidateOQSEItem(it);
        if (!r.success || !r.data) throw new Error(`invalid item @ ${i}`);
        return r.data;
      });
      await db.writeItems(setId, next);
    },
    async storeApplyMetaPatches(patches) {
      const current = (await db.getMeta(setId)) ?? {};
      await db.writeMeta(setId, apply(current, patches));
    },

    async assetUpload({ file, suggestedKey }) {
      return storage.put(suggestedKey ?? (file as File).name, file);
    },
    async assetGetRaw(key) { return storage.get(key); },
  };

  const connection = connect<PluginApi>({
    messenger,
    methods: hostApi as unknown as Methods, // see SDK's own cast note
  });

  return {
    connection,
    plugin: connection.promise, // → PluginApi proxy for host→plugin calls
  };
}
```

---

## 8. Version compatibility matrix

| SDK version | Host protocol          |
|-------------|------------------------|
| `0.2.x`     | Manual `postMessage` (deprecated — not covered here) |
| `0.3.x`     | This document. Penpal v7 + mutative JSON patches. |

The host SHOULD surface the plugin's `identity.version` in its admin UI to
help debug mismatches.

---

## 9. Security checklist

- [ ] Set a strict `allowedOrigins` on your `WindowMessenger`.
- [ ] Never trust `identity.id` — the plugin chose its own id. Match it
      against the entitlement you granted the iframe URL.
- [ ] Validate **every** `OQSEItem`, `OQSEMeta`, and `ProgressRecord` with
      `@memizy/oqse` Zod schemas before persisting.
- [ ] Sanitize asset MIME types and enforce size limits in `assetUpload`.
- [ ] Consider a CSP for the plugin iframe (`sandbox="allow-scripts"`,
      `Content-Security-Policy`) to cap blast radius.
