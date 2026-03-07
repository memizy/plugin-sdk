<div align="center">

# 🛠️ Memizy Plugin API & SDK
**Build interactive study modules for the OQSE ecosystem.**

![Version](https://img.shields.io/badge/npm-v0.2.0-blue?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-success?style=for-the-badge)

</div>

---

## 💡 What is this?

Memizy host applications use a **sandboxed iframe architecture** to render study sets. This SDK provides a TypeScript library around the `window.postMessage` API, allowing custom plugins to communicate with the host. The SDK also runs the **Leitner spaced-repetition algorithm internally**, keeping the host's OPFS progress store in sync after every interaction via the `SYNC_PROGRESS` message.

## 📦 Installation

```bash
npm install @memizy/plugin-sdk
```

Or use the CDN build directly in a static HTML plugin:

```html
<script type="module">
  import { MemizyPlugin } from 'https://cdn.jsdelivr.net/npm/@memizy/plugin-sdk@0.2.0/dist/memizy-sdk.js';
</script>
```

## 🏗️ Architecture

**State-Sync + CRUD + Asset Bridge**

| Role | Responsibility |
|---|---|
| **Host (Memizy Player)** | Owns persistent storage. Fetches study sets from OPFS, rewards Fuel, persists OQSEP progress to IndexedDB / Supabase. |
| **Plugin (SDK)** | Owns session-level state. Renders items, runs the Leitner reducer internally, pushes progress deltas via `SYNC_PROGRESS`. Can read/write OPFS assets through the host bridge. |

## 🧭 Standalone Mode

The SDK automatically detects when the plugin is running outside a Memizy host (`window.self === window.top`) and enters **Standalone Mode**. The developer's `onInit` callback is called identically in all cases — no extra code is needed.

**Priority order:**

| # | Condition | Behaviour |
|---|-----------|-----------|
| 1 | Running inside the Memizy iframe | Waits for `INIT_SESSION` postMessage from host |
| 2 | `useMockData()` was called | Fires `onInit` after `standaloneTimeout` ms if no host message arrives |
| 3 | `?set=<url>` query parameter present | Fetches the OQSE JSON from that URL and fires `onInit` automatically |
| 4 | None of the above | Shows a floating ⚙ gear icon and opens a settings dialog |

A **floating ⚙ gear button** (bottom-right corner, closed Shadow DOM) is shown in standalone mode. Clicking it opens a dialog with two tabs:

- **Study Set** — load via URL, paste OQSE JSON, or upload a `.oqse.json` file (drag & drop supported)
- **Progress** — load OQSEP progress via pasted JSON or `.oqsep` file upload

Set `showStandaloneControls: false` to suppress the built-in UI entirely.

**Using `?set=` during development:**

```
http://localhost:5173/?set=https://example.com/my-set/data.oqse.json
```

All relative `MediaObject.value` paths in `meta.assets` and `item.assets` are automatically resolved to absolute URLs so plugins always receive ready-to-use asset URLs.

## 📊 State-Sync & Spaced Repetition

The SDK runs a **Leitner spaced-repetition reducer** internally on every `answer()` call. Each answer:

1. Stops the item timer (or uses an explicit `timeSpent`).
2. Computes a new `ProgressRecord` — advances the bucket (0→4) on correct, resets to 1 on incorrect — and sets `nextReviewAt`.
3. Immediately sends `SYNC_PROGRESS` to the host to keep the OPFS copy in sync.

`skip()` records `isSkipped: true` in `lastAnswer` without touching the bucket or stats, and also sends `SYNC_PROGRESS`.

## ✏️ CRUD — Study Set Mutation

Plugins can modify the study set at any time during a session:

```typescript
plugin.saveItems(items)       // Create or update items (merged by id)
plugin.deleteItems(itemIds)   // Delete items by UUID
plugin.updateMeta(partialMeta) // Update title, tags, assets, etc.
```

## 🗂️ Asset Bridge

Because plugins run in a cross-origin `<iframe>`, they cannot access OPFS directly. The SDK proxies asset I/O through the host:

```typescript
// Upload a file to host OPFS and get back a MediaObject
const media = await plugin.uploadAsset(file, 'hero-image');
plugin.saveItems([{ ...item, assets: { image: media } }]);

// Read a raw file from host OPFS
const file = await plugin.getRawAsset('skull-model');
const url = URL.createObjectURL(file);
```

## 🚀 Quick Start

```typescript
import { MemizyPlugin } from '@memizy/plugin-sdk';
import type { OQSEItem, InitSessionPayload } from '@memizy/plugin-sdk';

const plugin = new MemizyPlugin({
  id: 'https://my-domain.com/flashcard-plugin',  // must match OQSE manifest id
  version: '1.0.0',
  debug: true,
});

// Optional: provide mock data for development outside the host
plugin.useMockData([
  { id: 'q1', type: 'flashcard', question: 'What is 2+2?', answer: '4' },
  { id: 'q2', type: 'flashcard', question: 'Capital of France?', answer: 'Paris' },
]);

let items: OQSEItem[] = [];
let cursor = 0;

plugin.onInit(({ items: sessionItems, progress }: InitSessionPayload) => {
  items = sessionItems;
  showItem(items[cursor]!);
});

function showItem(item: OQSEItem) {
  plugin.startItemTimer(item.id);
  document.getElementById('question')!.textContent = String(item['question']);
}

document.getElementById('btn-correct')!.addEventListener('click', () => {
  const item = items[cursor]!;
  plugin.answer(item.id, true, { confidence: 4 });  // runs Leitner, sends SYNC_PROGRESS
  if (++cursor < items.length) showItem(items[cursor]!);
  else plugin.exit({ score: 100 });
});

document.getElementById('btn-wrong')!.addEventListener('click', () => {
  const item = items[cursor]!;
  plugin.answer(item.id, false, { confidence: 1 });
  if (++cursor < items.length) showItem(items[cursor]!);
  else plugin.exit({ score: 0 });
});
```

## 📚 API Summary

### Constructor options

| Option | Type | Default | Description |
|---|---|---|---|
| `id` | `string` | — | Unique plugin identifier (URL or URN-UUID). Must match the OQSE manifest. |
| `version` | `string` | — | SemVer version of the plugin. |
| `standaloneTimeout` | `number` | `2000` | ms to wait for `INIT_SESSION` before entering standalone/mock mode. |
| `debug` | `boolean` | `false` | Log lifecycle events to the browser console. |
| `showStandaloneControls` | `boolean` | `true` | Show the floating ⚙ gear UI in standalone mode. |

### Key methods

| Method | Description |
|---|---|
| `onInit(handler)` | Called when `INIT_SESSION` is received (or standalone fires). |
| `onConfigUpdate(handler)` | Called when `CONFIG_UPDATE` is received (theme/locale change). |
| `answer(id, isCorrect, opts?)` | Record answer → run Leitner → send `SYNC_PROGRESS`. |
| `skip(id)` | Record skip (isSkipped=true) → send `SYNC_PROGRESS`. |
| `syncProgress(records)` | Bulk-merge progress records and push to host. |
| `getProgress()` | Snapshot of current internal progress state. |
| `saveItems(items)` | Send `MUTATE_ITEMS` to host. |
| `deleteItems(ids)` | Send `DELETE_ITEMS` to host. |
| `updateMeta(meta)` | Send `MUTATE_META` to host. |
| `uploadAsset(file, key?)` | Upload file to host OPFS → `Promise<MediaObject>`. |
| `getRawAsset(key)` | Read raw file from host OPFS → `Promise<File>`. |
| `exit(opts?)` | Send `EXIT_REQUEST` (replaces old `complete()`). |
| `startItemTimer(id)` | Start per-item stopwatch. |
| `stopItemTimer(id)` | Stop timer, return elapsed ms. |
| `clearItemTimer(id)` | Stop timer silently. |
| `useMockData(items, opts?)` | Register mock data for standalone dev mode. |
| `triggerMock()` | Fire `onInit` with mock data immediately. |
| `isStandalone()` | Returns `true` when running outside a host frame. |
| `destroy()` | Clean up listeners, timers, and standalone UI. |

## 📚 Documentation

Full protocol specification: [plugin-sdk-api-v1.md](plugin-sdk-api-v1.md)

<div align="center">
<i>Maintained with ❤️ by the Memizy Team.</i>
</div>
