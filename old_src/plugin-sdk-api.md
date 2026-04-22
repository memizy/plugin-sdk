# Plugin API Specification v1.0

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Plugin Distribution](#plugin-distribution)
- [Lifecycle](#lifecycle)
- [Message Protocol](#message-protocol)
  - [Host → Plugin messages](#host--plugin-messages)
  - [Plugin → Host messages](#plugin--host-messages)
- [Message Reference Table](#message-reference-table)
- [Development Guidelines](#development-guidelines)
- [Documentation](#documentation)
- [SDK Reference](#sdk-reference)
  - [Installation](#installation)
  - [API](#api)
  - [Text Processing API](#text-processing-api)
  - [Usage examples](#usage-examples)
- [Project Setup Guide](#project-setup-guide)
  - [Scaffolding a new plugin](#scaffolding-a-new-plugin)
  - [README template](#readme-template)
  - [License](#license)

---

## Overview

The Memizy Plugin API allows developers to create custom interactive learning experiences (games, quizzes, simulators) that integrate with the Memizy platform. Plugins run inside a sandboxed `<iframe>` and communicate with the Host (Memizy Player) via a structured message protocol built on `window.postMessage`.

**Plugin developers should use the official SDK** (`@memizy/plugin-sdk`) rather than calling `window.postMessage` directly. The SDK abstracts the low-level protocol, provides type safety, handles the initialization handshake, runs the spaced-repetition algorithm internally, and offers a full standalone development mode.

---

## Architecture

**State-Sync + CRUD + Asset Bridge**

| Role | Responsibility |
| :--- | :--- |
| **Host (Memizy Player)** | Owns persistent state. Fetches study sets from its own storage, rewards Fuel, persists OQSEP progress. Accepts state deltas from the plugin via `SYNC_PROGRESS`, `MUTATE_ITEMS`, `DELETE_ITEMS`, `MUTATE_META`. |
| **Plugin (SDK)** | Owns session-level state. Renders items, captures user input, runs the Leitner spaced-repetition reducer internally, and pushes progress deltas to the Host after every interaction. Can read/write assets through the host bridge (`STORE_ASSET`, `REQUEST_RAW_ASSET`). |

**Security model:** Plugins run in a cross-origin `<iframe>`. The Host verifies the `event.origin` or compares the source `Window` reference on every incoming message. Plugins MUST send all messages to `window.parent` only.

---

## Plugin Distribution

Memizy supports two plugin distribution channels. Both require a valid OQSE Application Manifest.

1. **Registry / self-hosted entrypoint URL**
  - The plugin is hosted by the plugin author (or CDN) and referenced by URL.
  - `id` in SDK configuration MUST match manifest `id`.
  - Host loads plugin in an iframe from the configured URL.

2. **Direct app upload package**
  - The plugin is uploaded to the Memizy app as a single packaged artifact.
  - The package MUST include an `index.html` entrypoint with embedded manifest metadata.
  - Host extracts and serves the package in a sandboxed runtime.

Canonical manifest rules and examples:
[OQSE Manifest Specification](https://github.com/memizy/oqse-specification/blob/main/oqse-manifest.md).

---

## Lifecycle

```
Plugin iframe loads
        |
        v
Plugin ----[PLUGIN_READY]--------------------------------------------> Host
                                                                          |
                                                         Host sends <-----+
                                                       INIT_SESSION
                                                   (+ optional progress)
                                                          |
                                                          v
                                               Plugin initializes
                                                          |
                                                          v (loop)
  User answers -- answer() ---[SYNC_PROGRESS]----------> Host (sync)
  User skips   -- skip()   ---[SYNC_PROGRESS]----------> Host (sync)
                                                          |
                                                          v (optional CRUD)
  saveItems()  ------------[MUTATE_ITEMS]--------------> Host
  deleteItems() -----------[DELETE_ITEMS]--------------> Host
  updateMeta()  -----------[MUTATE_META]---------------> Host
                                                          |
                                                          v (optional asset bridge)
  uploadAsset() -----------[STORE_ASSET]---------------> Host
  Host responds <----------[ASSET_STORED]-------------- Host
  getRawAsset() -----------[REQUEST_RAW_ASSET]---------> Host
  Host responds <----------[RAW_ASSET_PROVIDED]-------- Host
                                                          |
                                                          v
  Plugin done --------------[EXIT_REQUEST]-------------> Host shows summary
                                                          |
  (or host aborts) <-------[SESSION_ABORTED]----------- Host
```

**Detailed steps:**

1. **Ready Handshake:** Plugin sends `PLUGIN_READY` as soon as the DOM is interactive. This solves a race condition where the Host might otherwise fire `INIT_SESSION` before the plugin's message listener is active.
2. **Initialization:** Host responds with `INIT_SESSION`, containing the full study set, session settings, and optionally the user's existing OQSEP progress data keyed by item UUID.
3. **Gameplay loop:** Plugin renders items. For each user interaction it calls `plugin.answer()` or `plugin.skip()`. The SDK runs the Leitner reducer, updates its internal progress store, and immediately sends `SYNC_PROGRESS` to keep the host's storage in sync.
4. **CRUD (optional):** Plugin may modify the study set (add/edit items, delete items, update metadata) at any point during a session using `saveItems()`, `deleteItems()`, `updateMeta()`.
5. **Asset bridge (optional):** Plugins inside a cross-origin iframe cannot access host storage directly. `uploadAsset()` and `getRawAsset()` proxy asset reads/writes through the Host, which responds with `ASSET_STORED` or `RAW_ASSET_PROVIDED`.
6. **Exit:** Plugin calls `exit()` to send `EXIT_REQUEST`. The Host handles summary, rewards, and navigation.
7. **Abort:** Host fires `SESSION_ABORTED` when the user navigates away mid-session. Plugin SHOULD stop timers and release resources.

---

## Message Protocol

All messages conform to the envelope:

```typescript
interface PluginMessage<T extends string, P = undefined> {
  type: T;
  payload?: P;
}
```

### Host → Plugin messages

#### `INIT_SESSION`

Sent in response to `PLUGIN_READY`. Contains the complete study material for the session and, if available, the user's prior OQSEP progress.

```typescript
{
  type: 'INIT_SESSION',
  payload: {
    sessionId: string,               // Unique ID for this play session
    items: OQSEItem[],               // Full OQSE items array (subset of file)
    assets: Record<string, MediaObject>,  // Set-level shared assets from meta.assets
    setMeta?: OQSEMeta,              // Optional set-level metadata from the loaded OQSE file
    settings: {
      locale: string,                // BCP 47 locale of the UI ("en", "cs")
      theme: 'light' | 'dark' | 'system'
    },
    progress?: Record<string, ProgressRecord>  // OQSEP progress (keyed by item UUID)
  }
}
```

#### `SESSION_ABORTED`

Sent when the Host terminates the session externally (user pressed "Abort", browser tab change, etc.). Plugin MUST stop all timers and MUST NOT send further messages after receiving this.

```typescript
{
  type: 'SESSION_ABORTED',
  payload: {
    reason: 'user_exit' | 'timeout' | 'host_error'
  }
}
```

#### `CONFIG_UPDATE`

Sent when runtime settings change (e.g., user toggles dark mode or changes locale from a host overlay).

```typescript
{
  type: 'CONFIG_UPDATE',
  payload: {
    theme?: 'light' | 'dark' | 'system',
    locale?: string
  }
}
```

#### `ASSET_STORED`

Response to a `STORE_ASSET` message. Contains the resolved `MediaObject` for the uploaded asset, or an error string.

```typescript
{
  type: 'ASSET_STORED',
  payload: {
    requestId: string,             // Echoed from STORE_ASSET
    mediaObject?: MediaObject,     // Populated on success
    error?: string                 // Populated on failure
  }
}
```

#### `RAW_ASSET_PROVIDED`

Response to a `REQUEST_RAW_ASSET` message. Contains the raw `File` object, or an error string.

```typescript
{
  type: 'RAW_ASSET_PROVIDED',
  payload: {
    requestId: string,             // Echoed from REQUEST_RAW_ASSET
    file?: File,                   // Populated on success
    error?: string                 // Populated on failure
  }
}
```

---

### Plugin → Host messages

#### `PLUGIN_READY`

MUST be the first message sent by every plugin. Signals that the DOM is ready and the message listener is active.

```typescript
{
  type: 'PLUGIN_READY',
  payload: {
    id: string,                    // Matches the manifest id field (URL or URN-UUID)
    version: string                // SemVer string of the plugin, e.g. "1.0.0"
  }
}
```

#### `SYNC_PROGRESS`

Sent by the SDK after every `answer()` or `skip()` call. Contains a partial map of item UUIDs to their updated `ProgressRecord`. The Host merges these into its persistent OQSEP store.

```typescript
{
  type: 'SYNC_PROGRESS',
  payload: Record<string, ProgressRecord>  // One or more updated records
}
```

> **Note:** The SDK handles sending `SYNC_PROGRESS` automatically inside `answer()` and `skip()`. Plugins should not send this message directly — use `syncProgress()` only when bulk-loading external records.

#### `MUTATE_ITEMS`

Persist new or updated items to the Host's persistent storage. The Host merges by `id`.

```typescript
{
  type: 'MUTATE_ITEMS',
  payload: {
    items: OQSEItem[]              // Items to create or update (merged by id)
  }
}
```

#### `DELETE_ITEMS`

Delete items from the Host's persistent storage by their UUIDs.

```typescript
{
  type: 'DELETE_ITEMS',
  payload: {
    itemIds: string[]              // UUIDs of items to remove
  }
}
```

#### `MUTATE_META`

Update the study set's metadata in the Host's storage. Only the supplied fields are overwritten; others remain unchanged.

```typescript
{
  type: 'MUTATE_META',
  payload: {
    meta: Partial<OQSEMeta>        // Fields to overwrite (title, tags, assets, etc.)
  }
}
```

#### `STORE_ASSET`

Upload a `File` or `Blob` through the Host into its storage. The Host stores it, creates a `MediaObject` in the set's asset registry, and responds with `ASSET_STORED`.

```typescript
{
  type: 'STORE_ASSET',
  payload: {
    requestId: string,             // Client-generated UUID for correlation
    file: File | Blob,             // The asset to store
    suggestedKey: string           // Logical key in the assets registry (e.g. "hero-image")
  }
}
```

#### `REQUEST_RAW_ASSET`

Request the raw `File` for an asset stored in the Host's storage. The Host responds with `RAW_ASSET_PROVIDED`.

```typescript
{
  type: 'REQUEST_RAW_ASSET',
  payload: {
    requestId: string,             // Client-generated UUID for correlation
    key: string                    // Logical asset key (e.g. "skull-model")
  }
}
```

#### `EXIT_REQUEST`

Signal to the Host that the session is over.

```typescript
{
  type: 'EXIT_REQUEST',
  payload: {
    score: number | null,          // Plugin's internal score (0–100), or null
    totalTimeSpent: number         // Total session time in milliseconds
  }
}
```

#### `RESIZE_REQUEST`

Request that the Host resize the iframe container. The Host MAY ignore this if it controls layout exclusively.

```typescript
{
  type: 'RESIZE_REQUEST',
  payload: {
    height: number | 'auto',       // Desired height in px, or 'auto'
    width: number | 'auto' | null  // null = do not change
  }
}
```

#### `PLUGIN_ERROR`

Sent for non-fatal errors that the Host should log. Plugin MUST continue running after sending this. For fatal errors, display your own error UI and then send `EXIT_REQUEST` with `score: null`.

```typescript
{
  type: 'PLUGIN_ERROR',
  payload: {
    code: string,                  // Short camelCase error code, e.g. "UNSUPPORTED_TYPE"
    message: string,               // Human-readable description
    itemId: string | null,         // Associated item if applicable
    context: Record<string, unknown> | null
  }
}
```

---

## Message Reference Table

| Message | Direction | Required | Description |
| :--- | :--- | :--- | :--- |
| `PLUGIN_READY` | Plugin → Host | **Yes** | Plugin initialized, ready for data |
| `INIT_SESSION` | Host → Plugin | **Yes** | Study set + session settings + optional progress |
| `SYNC_PROGRESS` | Plugin → Host | **Yes** | Push `ProgressRecord` deltas to host storage after every answer/skip |
| `EXIT_REQUEST` | Plugin → Host | **Yes** | Plugin finished; host shows summary |
| `SESSION_ABORTED` | Host → Plugin | No | Host terminated the session externally |
| `CONFIG_UPDATE` | Host → Plugin | No | Theme / locale changed at runtime |
| `MUTATE_ITEMS` | Plugin → Host | No | Create or update items in the study set |
| `DELETE_ITEMS` | Plugin → Host | No | Delete items from the study set |
| `MUTATE_META` | Plugin → Host | No | Update study set metadata |
| `STORE_ASSET` | Plugin → Host | No | Upload a file asset through host to its storage |
| `ASSET_STORED` | Host → Plugin | No | Response to STORE_ASSET (success or error) |
| `REQUEST_RAW_ASSET` | Plugin → Host | No | Request a raw file from host storage |
| `RAW_ASSET_PROVIDED` | Host → Plugin | No | Response to REQUEST_RAW_ASSET (success or error) |
| `RESIZE_REQUEST` | Plugin → Host | No | Request iframe resize |
| `PLUGIN_ERROR` | Plugin → Host | No | Non-fatal error for host telemetry |

---

## Development Guidelines

1. **Always use the SDK.** Direct `postMessage` calls are an anti-pattern. The SDK handles the handshake, Leitner reducer, SYNC_PROGRESS dispatch, asset bridge, and standalone mode automatically.
2. **Responsiveness.** Plugins MUST be fully responsive. The Host may embed the iframe at any width from 320 px (mobile) upward.
3. **Touch-first.** All interactive targets MUST be at least 44×44 px  the same standard used by the Memizy app itself.
4. **Sync every answer.** Call `plugin.answer()` or `plugin.skip()` for every item the user interacts with. This ensures the host's storage stays in sync and progress is never lost.
5. **Graceful fallback.** If a plugin receives an item type it does not support, call `plugin.skip(itemId)` and continue with the next item. It MUST NOT crash.
6. **Standalone / Dev mode.** The SDK detects when it is running outside a Memizy host frame (`window.self === window.top`) and handles session startup automatically. The developer's `onInit` callback is called identically in all cases  no extra code is required in the plugin.
7. **No external tracking.** Plugins MUST NOT include third-party analytics or tracking scripts. All telemetry flows through the Host via the message protocol.
8. **Manifest required.** Every distributed plugin MUST provide a valid OQSE Application Manifest.
  For URL entrypoints, host the manifest with the plugin entrypoint. For direct app uploads, embed the manifest in `index.html`.
  Canonical manifest reference:
   [OQSE Manifest Specification](https://github.com/memizy/oqse-specification/blob/main/oqse-manifest.md).

## Documentation

- Full API and protocol reference: [plugin-sdk-api.md](plugin-sdk-api.md)
- OQSEM (Application Manifest): [oqse-manifest.md](https://github.com/memizy/oqse-specification/blob/main/oqse-manifest.md)
- OQSE (Core Study Sets): [oqse.md](https://github.com/memizy/oqse-specification/blob/main/oqse.md)
- OQSEH (Set Headers/Registries): [oqse-header.md](https://github.com/memizy/oqse-specification/blob/main/oqse-header.md)
- OQSEP (User Progress): [oqse-progress.md](https://github.com/memizy/oqse-specification/blob/main/oqse-progress.md)

---

## SDK Reference

The `@memizy/plugin-sdk` is a lightweight, fully typed TypeScript library built on top of `@memizy/oqse`. It is the recommended (and for published plugins, required) way to build Memizy plugins.

**Source:** [src/index.ts](src/index.ts)

### Installation

```bash
# npm
npm install @memizy/plugin-sdk
```

Or use the CDN build directly in a static HTML plugin via jsDelivr:

```html
<script type="module">
  import { MemizyPlugin } from 'https://cdn.jsdelivr.net/npm/@memizy/plugin-sdk@0.2.1/dist/memizy-sdk.js';
</script>
```

### API

#### Constructor

```typescript
const plugin = new MemizyPlugin({
  id: 'https://my-domain.com/my-plugin',  // MUST match manifest id (URL or URN-UUID)
  version: '1.0.0',                       // SemVer of this plugin
  standaloneTimeout: 2000,                // ms to wait before mock/standalone fallback (default: 2000)
  debug: true,                            // Log SDK lifecycle events to console (default: false)
  standaloneControlsMode: 'auto',         // 'auto' (gear visible) | 'hidden' (no gear, manual open)
  standaloneUiPosition: 'bottom-right',   // Gear corner in auto mode
});
```

The constructor immediately registers the `message` event listener and sends `PLUGIN_READY` to the host.

---

#### Standalone Mode

Standalone mode is a lightweight, ephemeral development runtime focused on DX and fast Vite HMR.

The SDK automatically detects when the plugin is not running inside a Memizy host frame (`window.self === window.top`) and handles session startup without any extra plugin code.

State behavior:

- The active standalone set + progress are persisted to `sessionStorage` under `memizy_dev_state`.
- This keeps state alive across page reloads in the same tab for smoother HMR development.
- The state is intentionally ephemeral and development-oriented.

**Priority chain (evaluated in order):**

| # | Condition | Action |
|---|-----------|--------|
| 1 | Host iframe — `INIT_SESSION` postMessage arrives | Normal path; `onInit` fired by host message |
| 2 | `sessionStorage[memizy_dev_state]` contains valid standalone state | Session resumes immediately from saved items + progress |
| 3 | `useMockData()` was called | `onInit` fired after `standaloneTimeout` ms (default: 2000) if no host message |
| 4 | URL contains `?set=<url>` | OQSE JSON fetched automatically; `onInit` fired |
| 5 | None of the above | Standalone controls are created; dialog auto-opens only in `standaloneControlsMode: 'auto'` |

**Standalone controls modes**

The SDK provides two standalone control modes:

- **`auto` (default):** injects a semi-transparent ⚙ gear button in the configured corner. The dialog auto-opens when no set data is available.
- **`hidden`:** does not render the gear button. The plugin can open the same dialog programmatically.

The settings dialog includes two tabs:

- **Study Set** — load via URL input, paste OQSE JSON text, or upload/drag-and-drop a `.json` file
- **Progress** — load OQSEP progress via pasted JSON text or `.oqsep` file upload

When no `?set=` URL or mock data is present, the dialog opens automatically only in `auto` mode. After a set is loaded, the dialog hides.

Use `openStandaloneControls()` to open the dialog in hidden mode:

```typescript
plugin.openStandaloneControls();
```

**`?set=` quick-launch URL**

```
http://localhost:5173/?set=https://example.com/my-set/data.oqse.json
```

The SDK fetches the URL, parses the OQSE JSON, and fires `onInit` with a synthetic `InitSessionPayload`. Plugin source code remains unchanged.

**Local asset testing**

For standalone development:

- Use absolute URLs in JSON assets (for example `http://localhost:5173/image.png`).
- Use `useMockData()` to inject local test assets.
- Use `uploadAsset()` to test asset flow; standalone mode returns session-local `blob:` URLs.

If your plugin needs advanced local persistence for plugin-specific features, implement it in plugin code with browser APIs (`localStorage` / `IndexedDB`). The SDK remains focused on protocol bridge behavior.

**Automatic asset resolution**

All relative `MediaObject.value` paths inside `meta.assets` and per-item `assets` are resolved to absolute URLs using the OQSE file's base URL before `onInit` is called. Values that already start with a scheme (`https://`, `data:`, etc.) are left untouched.

---

#### Host → Plugin callbacks

```typescript
// Called when INIT_SESSION is received (or standalone equivalent fires)
plugin.onInit((payload: InitSessionPayload) => {
  // payload.items    — OQSE items for this session
  // payload.assets    — set-level shared assets, pre-resolved to absolute URLs
  // payload.setMeta   — optional set-level OQSE meta object
  // payload.settings  — session environment settings (theme, locale)
  // payload.progress  — existing ProgressRecord map (may be undefined)
}): this

// Called when CONFIG_UPDATE is received
plugin.onConfigUpdate((config: Partial<Pick<SessionSettings, 'theme' | 'locale'>>) => {
  // Apply theme/locale change to the plugin UI
}): this
```

---

#### State-Sync

The SDK runs the Leitner spaced-repetition reducer internally and sends `SYNC_PROGRESS` to the host automatically.

```typescript
// Record a correct or incorrect answer for an item.
// - Stops the item timer automatically (or uses options.timeSpent).
// - Runs the Leitner reducer → new ProgressRecord.
// - Sends SYNC_PROGRESS to the host.
plugin.answer(
  itemId: string,
  isCorrect: boolean,
  options?: {
    answer?: string;       // Raw string answer
    confidence?: 1 | 2 | 3 | 4;  // OQSEP 4-point scale
    timeSpent?: number;    // ms; inferred from timer if omitted
    hintsUsed?: number;    // Number of hints used (default: 0)
  }
): this

// Record that the user skipped an item without answering.
// - Does NOT modify the bucket or stats.
// - Sets lastAnswer.isSkipped = true.
// - Sends SYNC_PROGRESS.
plugin.skip(itemId: string): this

// Bulk-merge external ProgressRecords into the internal store and send SYNC_PROGRESS.
// Useful for loading saved progress from a file or server.
plugin.syncProgress(records: Record<string, ProgressRecord>): this

// Returns a snapshot of the current internal progress state (keyed by item UUID).
plugin.getProgress(): Record<string, ProgressRecord>
```

---

#### CRUD — Study Set Mutation

```typescript
// Persist new or updated items to the Host's storage (merged by id).
plugin.saveItems(items: OQSEItem[]): this

// Delete items by UUID from the Host's storage.
plugin.deleteItems(itemIds: string[]): this

// Update study set metadata (title, description, tags, assets, etc.).
// Only supplied fields are overwritten.
plugin.updateMeta(meta: Partial<OQSEMeta>): this
```

---

#### Asset Bridge

Because plugins run in a cross-origin `<iframe>`, they cannot access host storage directly. The asset bridge proxies file I/O through the Host.

During session initialization (`INIT_SESSION`), the SDK stores `payload.assets` in an internal session asset registry. The Text Processing API then resolves `<asset:key />` tags against this in-memory map, so `parseTextTokens()` and `renderHtml()` can reference host-provided assets immediately.

```typescript
// Upload a File or Blob to the host's storage.
// Returns a Promise<MediaObject> with the stored asset descriptor.
//
// Example:
//   const media = await plugin.uploadAsset(file, 'hero-image');
//   plugin.saveItems([{ ...item, assets: { hero: media } }]);
plugin.uploadAsset(file: File | Blob, suggestedKey?: string): Promise<MediaObject>

// Request the raw File or Blob for an asset stored in host storage.
// Returns a Promise<File | Blob>.
//
// Example:
//   const file = await plugin.getRawAsset('skull-model');
//   const url = URL.createObjectURL(file);
plugin.getRawAsset(key: string): Promise<File | Blob>
```

---

#### Lifecycle

```typescript
// Signal to the host that the session is over.
// Sends EXIT_REQUEST with optional score and total time spent.
plugin.exit(options?: { score?: number | null }): this

// Request that the host resize the iframe container.
// The host MAY ignore this.
plugin.requestResize(height: number | 'auto', width?: number | 'auto' | null): this

// Log a non-fatal error to the host for telemetry/debugging.
// Plugin MUST continue running after calling this.
plugin.reportError(
  code: string,
  message: string,
  options?: { itemId?: string; context?: Record<string, unknown> }
): this

// Remove the message listener, reject pending asset promises, and destroy the standalone UI.
// Call this if you unmount the plugin manually.
plugin.destroy(): void
```

---

#### Timer utilities

```typescript
// Start a per-item stopwatch. Call when the item becomes visible.
// The elapsed time is automatically included in answer() and skip().
plugin.startItemTimer(itemId: string): this

// Stop the timer and return elapsed milliseconds. Clears the entry.
plugin.stopItemTimer(itemId: string): number

// Stop the timer silently (e.g., navigating away before user answers).
plugin.clearItemTimer(itemId: string): this
```

---

#### Text Processing API

The SDK exposes a text processing API with explicit unsafe/sanitized HTML rendering and tokenized parsing.

- `renderHtml(rawText, options)` returns HTML.
  Without `options.sanitizer`, the output is unsafe and MUST be sanitized before display.
  With `options.sanitizer`, the returned output has already been sanitized by your provided sanitizer.
- `parseTextTokens(rawText)` returns structured tokens (`text`, `blank`, `asset`) for token-driven UIs.
  Tokens are data, not sanitized HTML. If you map token text into HTML, you MUST escape or sanitize before display.

```typescript
// Parse raw text with <asset:key /> and <blank:key /> tags into typed tokens.
plugin.parseTextTokens(rawText: string): OQSETextToken[]

// Quick HTML rendering path.
plugin.renderHtml(
  rawText: string,
  options?: {
    markdownParser?: (text: string) => string | Promise<string>;
    sanitizer?: (html: string) => string;
  }
): string
```

Explicit safety examples:

```typescript
// Unsafe output path: MUST sanitize before display.
const unsafeHtml = plugin.renderHtml(rawText);
container.innerHTML = DOMPurify.sanitize(unsafeHtml);

// Sanitized output path: already sanitized by your policy callback.
const sanitizedHtml = plugin.renderHtml(rawText, {
  sanitizer: (html) => DOMPurify.sanitize(html),
});
container.innerHTML = sanitizedHtml;
```

Example:

```typescript
const html = plugin.renderHtml(item.question, {
  markdownParser: (text) => myMarkdown.parse(text),
  sanitizer: (unsafeHtml) => DOMPurify.sanitize(unsafeHtml),
});
container.innerHTML = html;
```

> **Security (IoC):** `renderHtml()` intentionally does **not** enforce a built-in sanitizer.
> Plugin developers own the sanitization policy.
> Treat output as unsafe unless you explicitly sanitize it before display.

---

#### Development helpers

```typescript
// Register mock items for standalone / dev mode.
// Suppresses the built-in standalone dialog.
// onInit fires after standaloneTimeout ms if no INIT_SESSION arrives from a host.
plugin.useMockData(items: OQSEItem[], options?: {
  settings?: Partial<SessionSettings>;
  assets?: Record<string, MediaObject>;
  progress?: Record<string, ProgressRecord>;
}): this

// Manually trigger onInit with mock data immediately (useful for unit tests).
plugin.triggerMock(): this

// Returns true when running outside the Memizy host (window.self === window.top).
plugin.isStandalone(): boolean
```

---

### Usage examples

#### Minimal flashcard plugin (TypeScript)

```typescript
import { MemizyPlugin } from '@memizy/plugin-sdk';
import type { OQSEItem, InitSessionPayload } from '@memizy/plugin-sdk';

const plugin = new MemizyPlugin({
  id: 'https://my-domain.com/flashcard-plugin',
  version: '1.0.0',
  debug: true,
});

plugin.useMockData([
  { id: 'q1', type: 'flashcard', question: 'What is 2 + 2?', answer: '4' },
  { id: 'q2', type: 'flashcard', question: 'Capital of France?', answer: 'Paris' },
]);

let items: OQSEItem[] = [];
let cursor = 0;

plugin.onInit(({ items: sessionItems, progress }: InitSessionPayload) => {
  items = sessionItems;
  console.log('Progress loaded:', progress);
  showItem(items[cursor]!);
});

function showItem(item: OQSEItem) {
  plugin.startItemTimer(item.id);
  document.getElementById('question')!.textContent = String(item['question']);
}

document.getElementById('btn-correct')!.addEventListener('click', () => {
  const item = items[cursor]!;
  plugin.answer(item.id, true, { confidence: 4 });
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

#### Asset upload example

```typescript
// Upload a user-selected image and attach it to an item
inputEl.addEventListener('change', async () => {
  const file = inputEl.files?.[0];
  if (!file) return;

  const media = await plugin.uploadAsset(file, 'card-image');
  plugin.saveItems([{ ...currentItem, assets: { image: media } }]);
});
```

#### Reading a raw host asset

```typescript
// Fetch a 3D model from host storage and display it locally
async function loadModel(key: string) {
  const file = await plugin.getRawAsset(key);
  const url = URL.createObjectURL(file);
  modelViewer.src = url;
}
```

#### Vanilla JavaScript (static HTML)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <script type="application/oqse-manifest+json">
  {
    "version": "1.0",
    "id": "https://my-domain.com/my-quiz",
    "appName": "My Quiz Plugin",
    "capabilities": { "actions": ["render"], "types": ["flashcard"] }
  }
  </script>
</head>
<body>
<div id="app"></div>
<script type="module">
  import { MemizyPlugin } from 'https://cdn.jsdelivr.net/npm/@memizy/plugin-sdk@0.2.1/dist/memizy-sdk.js';

  const plugin = new MemizyPlugin({ id: 'https://my-domain.com/my-quiz', version: '1.0.0' });

  plugin.useMockData([{ id: 'q1', type: 'flashcard', question: 'Test?', answer: 'Yes' }]);

  plugin.onInit(({ items, settings }) => {
    console.log('Locale:', settings.locale);
    const item = items[0];
    document.getElementById('app').innerHTML =
      `<h2>${item.question}</h2>
       <button id="ok">Correct</button>
       <button id="fail">Wrong</button>`;

    plugin.startItemTimer(item.id);
    document.getElementById('ok').addEventListener('click', () => {
      plugin.answer(item.id, true).exit({ score: 100 });
    });
    document.getElementById('fail').addEventListener('click', () => {
      plugin.answer(item.id, false).exit({ score: 0 });
    });
  });
</script>
</body>
</html>
```

---

## Project Setup Guide

### Scaffolding a new plugin

A Memizy plugin is a self-contained static web application. The minimal project structure is:

```
my-plugin/
 index.html          # Plugin entry point (MUST contain the OQSE manifest script tag)
 package.json
 vite.config.ts
 tsconfig.json
 src/
    main.ts
 public/
    preview.png     # 512×512 px preview image for the plugin catalog
 README.md
 LICENSE
```

**Step-by-step setup:**

```bash
# 1. Scaffold a Vite TypeScript project
npm create vite@latest my-plugin -- --template vanilla-ts
cd my-plugin

# 2. Install the SDK
npm install @memizy/plugin-sdk

# 3. Start the dev server
npm run dev
# Open http://localhost:5173
# The SDK enters standalone mode — use the ⚙ gear dialog to load a study set
# or append ?set=<url> to the page URL.

# 4. Build for production
npm run build
# Deploy the contents of dist/ as a static site.
```

**Minimal `package.json`:**

```json
{
  "name": "memizy-plugin-my-plugin",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@memizy/plugin-sdk": "^0.2.1"
  },
  "devDependencies": {
    "vite": "^6.0.0",
    "typescript": "^5.0.0"
  }
}
```

**Minimal `tsconfig.json`:**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["src"]
}
```

---

### README template

```markdown
# [Plugin Name]  Memizy Plugin

> One-sentence description of what the plugin does or teaches.

## Preview

![Preview screenshot](public/preview.png)

## Supported item types

| OQSE Type | Supported |
| :--- | :--- |
| `flashcard` |  |
| `mcq-single` |  |
| `short-answer` |  |

## Getting started (development)

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in your browser. The SDK enters standalone mode and fires `onInit` with mock data automatically.

## Building for production

```bash
npm run build
```

Deploy the contents of `dist/` as a static site (GitHub Pages, Cloudflare Pages, etc.).

## Plugin ID

`https://your-domain.com/your-plugin`

## License

[MIT](LICENSE)  [Your Name] [Year]
```

---

### License

Memizy plugins are encouraged to use the **MIT License**. Copy the text below into your `LICENSE` file:

```
MIT License

Copyright (c) [Year] [Author]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```