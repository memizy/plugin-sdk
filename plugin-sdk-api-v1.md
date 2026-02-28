# Plugin API Specification v1.0

## Table of Contents

- [Overview](#overview)
- [Lifecycle](#lifecycle)
- [Message Protocol](#message-protocol)
  - [Host → Plugin messages](#1-host--plugin)
  - [Plugin → Host messages](#2-plugin--host)
- [Message Reference Table](#message-reference-table)
- [Development Guidelines](#development-guidelines)
- [SDK Reference](#sdk-reference)
  - [Installation](#installation)
  - [API](#api)
  - [Usage examples](#usage-examples)
- [Project Setup Guide](#project-setup-guide)
  - [Scaffolding a new plugin](#scaffolding-a-new-plugin)
  - [README template](#readme-template)
  - [License](#license)

---

## Overview

The Memizy Plugin API allows developers to create custom interactive learning experiences (games, quizzes, simulators) that integrate with the Memizy platform. Plugins run inside a sandboxed `<iframe>` and communicate with the Host (Memizy Player) via a structured message protocol built on `window.postMessage`.

**Plugin developers should use the official SDK** (`@memizy/plugin-sdk`) rather than calling `window.postMessage` directly. The SDK abstracts the low-level protocol, provides type safety, handles the initialization handshake, and offers utilities for timers, progress tracking, and standalone development mode.

**Architecture:** Smart Host – Dumb Client

| Role | Responsibility |
| :--- | :--- |
| **Host (Memizy Player)** | Owns persistent state. Fetches study sets, calculates Fuel rewards, runs the Spaced Repetition algorithm, persists progress to IndexedDB / Supabase. |
| **Client (Plugin)** | Stateless UI layer. Renders items, captures user input, reports raw events back to the Host. MUST NOT access persistent storage or perform Spaced Repetition calculations. |

**Security model:** Plugins run in a cross-origin `<iframe>`. The Host verifies the `event.origin` or compares the source `Window` reference on every incoming message. Plugins MUST send all messages to `window.parent` only.

---

## Lifecycle

```
Plugin iframe loads
        │
        ▼
Plugin signals ──► PLUGIN_READY ──────────────────────────► Host
                                                              │
                                               Host sends ◄──┘
                                            INIT_SESSION
                                                │
                                                ▼
        Plugin initializes
                │
                ▼ (loop)
        User answers item ──► ITEM_ANSWERED ──────────────► Host
                                                              │ calculates Fuel,
        Plugin receives ◄── HINT_RESPONSE ◄── REQUEST_HINT   │ updates SRS
          hint text                            (optional)     │
                │
                ▼ (optional)
        Plugin reports ──► PROGRESS_UPDATE ───────────────► Host (updates HUD)
                │
                ▼ (optional branch)
        User pauses ────► SESSION_PAUSED ─────────────────► Host
        User resumes ◄── SESSION_RESUMED ◄─────────────────  Host
                │
                ▼
        All items done ──► SESSION_COMPLETED ──────────────► Host shows summary
                                                              │
        (or host aborts)◄── SESSION_ABORTED ◄──────────────  Host
```

**Detailed steps:**

1. **Ready Handshake:** Plugin sends `PLUGIN_READY` as soon as the DOM is interactive. This solves a race condition where the Host might otherwise fire `INIT_SESSION` before the plugin's message listener exists.
2. **Initialization:** Host responds with `INIT_SESSION`, containing the study set and session settings.
3. **Gameplay:** Plugin renders items. For each user interaction it fires `ITEM_ANSWERED` or `ITEM_SKIPPED`. It MAY send `PROGRESS_UPDATE` whenever its internal completion state changes.
4. **Hints (optional):** Plugin may call `REQUEST_HINT` for any item. The Host may deduct Fuel as a cost and responds with `HINT_RESPONSE`.
5. **Pause / Resume:** Plugin fires `SESSION_PAUSED` on internal pause (e.g., in-game menu). Host may also fire `SESSION_RESUMED` to wake the plugin back up (e.g., after the user dismisses a host-level overlay).
6. **Completion:** Plugin fires `SESSION_COMPLETED`. Host handles summary, rewards, and navigation.
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

### 1. Host → Plugin

#### `INIT_SESSION`

Sent in response to `PLUGIN_READY`. Contains the complete study material for the session.

```typescript
{
  type: 'INIT_SESSION',
  payload: {
    sessionId: "uuid-of-session",   // Unique ID for this play session
    items: OQSEItem[],               // Full OQSE items array (subset of file)
    settings: {
      shuffle: boolean,             // Whether items were shuffled by the host
      masteryMode: boolean,         // Only serve items below mastery threshold
      maxItems: number | null,      // Cap on items served (null = all)
      locale: string,               // BCP 47 locale of the UI ("en", "cs")
      theme: 'light' | 'dark' | 'system',
      fuel: {                       // Current gamification state
        balance: number,            // Current Fuel balance of the user
        multiplier: number          // Active streak multiplier (e.g., 1.5)
      }
    }
  }
}
```

#### `SESSION_RESUMED`

Sent when the Host un-pauses a session that was previously paused (either by the plugin or the host itself).

```typescript
{
  type: 'SESSION_RESUMED'
}
```

#### `SESSION_ABORTED`

Sent when the Host terminates the session externally (user pressed "Abort Mission", browser tab change, etc.). Plugin MUST stop all timers and MUST NOT send further messages after receiving this.

```typescript
{
  type: 'SESSION_ABORTED',
  payload: {
    reason: 'user_exit' | 'timeout' | 'host_error'
  }
}
```

#### `CONFIG_UPDATE`

Sent when runtime settings change (e.g., user toggles dark mode, changes locale from a host overlay).

```typescript
{
  type: 'CONFIG_UPDATE',
  payload: {
    theme?: 'light' | 'dark' | 'system',
    locale?: string
  }
}
```

#### `HINT_RESPONSE`

Response to a `REQUEST_HINT` sent by the plugin. May carry the hint text, or a denial if the cost could not be paid.

```typescript
{
  type: 'HINT_RESPONSE',
  payload: {
    itemId: string,
    granted: boolean,
    hintText: string | null,       // Populated when granted: true
    fuelCost: number,              // Fuel deducted (0 if denied or free)
    remainingFuel: number          // User's Fuel balance after deduction
  }
}
```

---

### 2. Plugin → Host

#### `PLUGIN_READY`

MUST be the first message sent by every plugin. Signals that the DOM is ready and the message listener is active. The Host will not send `INIT_SESSION` before receiving this.

```typescript
{
  type: 'PLUGIN_READY',
  payload: {
    id: string,                    // Matches the manifest id field (URL or URN-UUID)
    version: string                // SemVer string of the plugin, e.g. "1.0.0"
  }
}
```

#### `ITEM_ANSWERED`

MUST be sent for every item the user explicitly attempts. Drives the Spaced Repetition System and Fuel rewards.

```typescript
{
  type: 'ITEM_ANSWERED',
  payload: {
    itemId: string,                // MUST match an id from INIT_SESSION items
    isCorrect: boolean,
    timeSpent: number,             // Milliseconds from item display to answer
    answer: string | null,         // Raw user answer (string or null)
    confidence: 1 | 2 | 3 | null  // Optional: user self-reported confidence
                                   //   1 = unsure, 2 = okay, 3 = confident
  }
}
```

#### `ITEM_SKIPPED`

Sent when the user deliberately skips an item without answering. The Host records this as a non-answer for SRS purposes.

```typescript
{
  type: 'ITEM_SKIPPED',
  payload: {
    itemId: string,
    reason: 'user_skipped' | 'timeout' | 'not_supported'
                                   // not_supported: item type unknown to plugin
  }
}
```

#### `SESSION_COMPLETED`

Sent when the plugin has exhausted its item queue or the user completes the experience. Host shows the summary screen.

```typescript
{
  type: 'SESSION_COMPLETED',
  payload: {
    score: number | null,          // Optional internal game score (0–100)
    totalTimeSpent: number         // Total session time in milliseconds
  }
}
```

#### `SESSION_PAUSED`

Sent when the user pauses via an in-plugin control (e.g., in-game pause menu). Host MAY overlay a pause UI.

```typescript
{
  type: 'SESSION_PAUSED'
}
```

#### `PROGRESS_UPDATE`

Sent at meaningful milestones so the Host HUD can display a progress bar. Plugin SHOULD send this after every `ITEM_ANSWERED` but MAY throttle it.

```typescript
{
  type: 'PROGRESS_UPDATE',
  payload: {
    itemsDone: number,             // How many items have been answered or skipped
    itemsTotal: number,            // Total items in the session
    percentComplete: number        // 0–100 (derived, but explicit for convenience)
  }
}
```

#### `REQUEST_HINT`

Plugin asks the Host to unlock a hint for a specific item. The Host will respond with `HINT_RESPONSE`. Hints have a configurable Fuel cost set in the Host.

```typescript
{
  type: 'REQUEST_HINT',
  payload: {
    itemId: string
  }
}
```

#### `RESIZE_REQUEST`

Plugin requests a resize of the iframe container. Useful for plugins that change layout dynamically (e.g., reveal a results panel). The Host MAY ignore this if it controls layout exclusively.

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

Sent for non-fatal errors that the Host should log (e.g., unknown item type encountered, media failed to load). Plugin MUST continue running after sending this. For fatal errors, the plugin should display its own error UI and send `SESSION_COMPLETED` with `score: null`.

```typescript
{
  type: 'PLUGIN_ERROR',
  payload: {
    code: string,                  // Short error code, e.g. "UNSUPPORTED_TYPE"
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
| `INIT_SESSION` | Host → Plugin | **Yes** | Study set + session settings |
| `ITEM_ANSWERED` | Plugin → Host | **Yes** | User answered an item |
| `SESSION_COMPLETED` | Plugin → Host | **Yes** | Plugin finished |
| `SESSION_PAUSED` | Plugin → Host | No | Plugin paused internally |
| `SESSION_RESUMED` | Host → Plugin | No | Host un-paused the session |
| `SESSION_ABORTED` | Host → Plugin | No | Host terminated the session |
| `ITEM_SKIPPED` | Plugin → Host | No | User skipped an item |
| `PROGRESS_UPDATE` | Plugin → Host | No | Progress percentage for HUD |
| `REQUEST_HINT` | Plugin → Host | No | Request hint for an item |
| `HINT_RESPONSE` | Host → Plugin | No | Hint text or denial |
| `CONFIG_UPDATE` | Host → Plugin | No | Theme / locale changed |
| `RESIZE_REQUEST` | Plugin → Host | No | Request iframe resize |
| `PLUGIN_ERROR` | Plugin → Host | No | Non-fatal error for logging |

---

## Development Guidelines

1. **Always use the SDK.** Direct `postMessage` calls are an anti-pattern for plugin development. The SDK handles the handshake, serialization, and standalone mode automatically.
2. **Responsiveness.** Plugins MUST be fully responsive. The Host may embed the iframe at any width from 320 px (mobile) upward.
3. **Touch-first.** All interactive targets MUST be at least 44×44 px — the same standard used by the Memizy app itself.
4. **State ownership.** Plugins are stateless with respect to persistent data. They manage only visual / transient state. The Host is the sole source of truth for progress, Fuel, and SRS data.
5. **Graceful fallback.** If a plugin receives an item type it does not support, it MUST send `ITEM_SKIPPED` with `reason: 'not_supported'` and continue with the next item. It MUST NOT crash.
6. **Standalone / Dev mode.** The SDK detects when it is running outside a Memizy host frame (`window.self === window.top`) and automatically enters standalone mode. The developer's `onInit` callback is called identically in all cases — no extra code is required in the plugin. See the _Standalone Mode_ section of the SDK Reference for the full priority chain.
7. **No external tracking.** Plugins MUST NOT include third-party analytics or tracking scripts. All telemetry flows through the Host via the message protocol.
8. **Manifest required.** Every plugin MUST embed a valid OQSE Application Manifest (see [`open-study-exchange-v1.md`](open-study-exchange-v1.md), section 2.1) in a `<script type="application/oqse-manifest+json">` tag.

---

## SDK Reference

The `@memizy/plugin-sdk` is a zero-dependency TypeScript library that abstracts the full message protocol. It is the recommended (and for published plugins, required) way to build Memizy plugins.

**Source:** [src/index.ts](src/index.ts)

### Installation

```bash
# npm
npm install @memizy/plugin-sdk
```

Or use the CDN build directly in a static HTML plugin via jsDelivr:

```html
<script type="module">
  import { MemizyPlugin } from 'https://cdn.jsdelivr.net/npm/@memizy/plugin-sdk/dist/index.js';
</script>
```

### API

#### Constructor

```typescript
const plugin = new MemizyPlugin({
  id: 'https://my-domain.com/my-plugin',  // MUST match manifest id (URL or URN-UUID)
  version: '1.0.0',                       // SemVer of this plugin
  standaloneTimeout: 2000,                // Optional: ms to wait before mock fallback
});
```

The constructor immediately registers the `message` event listener and sends `PLUGIN_READY` to the host.

---

#### Standalone Mode

The SDK automatically detects when the plugin is not running inside a Memizy host frame (`window.self === window.top`) and handles the session startup without any extra plugin code.

**Priority chain (evaluated in order):**

| # | Condition | Action |
|---|-----------|--------|
| 1 | Host iframe — `INIT_SESSION` postMessage arrives | Normal path; `onInit` fired by host message |
| 2 | `useMockData()` was called | `onInit` fired after `standaloneTimeout` ms (default: 2000) if no host message |
| 3 | URL contains `?set=<url>` | OQSE JSON fetched automatically from that URL; `onInit` fired |
| 4 | None of the above | Built-in Shadow DOM URL-input dialog injected by the SDK |

**`?set=` quick-launch URL**

The recommended development workflow for standalone plugins is to serve the plugin locally and pass the study-set URL as a query parameter:

```
http://localhost:5173/index.html?set=https://example.com/my-set/data.oqse.json
```

The SDK fetches the URL, parses the `items` array from the OQSE JSON, and fires `onInit` with a synthetic `InitSessionPayload`. The plugin source code remains completely unchanged.

**Built-in URL dialog**

When neither a `?set=` param nor mock data is present, the SDK injects a fully isolated Shadow DOM overlay into the page. The user (developer) can paste any OQSE file URL and click **Load**. On success the overlay is removed and `onInit` fires normally.

**Automatic asset resolution**

In standalone mode the SDK automatically resolves all relative `MediaObject.value` paths inside `meta.assets` and every `item.assets` entry to absolute URLs, using the base URL of the fetched OQSE file. For example, if the OQSE file lives at `https://example.com/sets/geo/data.json` and an asset has `"value": "assets/map.png"`, the SDK rewrites it to `"value": "https://example.com/sets/geo/assets/map.png"` before calling `onInit`. Values that already start with a scheme (e.g., `https://`, `data:`) are left untouched.

This means plugins always receive absolute URLs in `item.assets[key].value` regardless of whether the OQSE file used relative paths.

> **Note:** Custom extension fields on items (e.g. `_assetUrl`) are **not** resolved automatically — only standard OQSE `assets` dictionaries are processed. If a plugin uses non-standard fields with relative paths, it must resolve them itself using the source URL available from `new URLSearchParams(location.search).get('set')`.

---

#### Host → Plugin callbacks

```typescript
// Called when the Host sends INIT_SESSION
plugin.onInit((payload: InitSessionPayload) => { ... }): this

// Called when the Host sends SESSION_RESUMED
plugin.onResumed((): void => { ... }): this

// Called when the Host sends SESSION_ABORTED
plugin.onAborted((reason: AbortReason) => { ... }): this

// Called when the Host sends CONFIG_UPDATE
plugin.onConfigUpdate((config: Partial<Pick<SessionSettings, 'theme' | 'locale'>>) => { ... }): this

// Called when the Host sends HINT_RESPONSE
plugin.onHint((response: HintResponsePayload) => { ... }): this
```

---

#### Plugin → Host actions

```typescript
// Report an answered item.
// If startItemTimer(itemId) was called, timeSpent is measured automatically.
plugin.answer(itemId: string, isCorrect: boolean, options?: {
  answer?: string;
  confidence?: 1 | 2 | 3;
  timeSpent?: number;  // ms; inferred from timer if omitted
}): this

// Report a skipped item
plugin.skip(itemId: string, reason?: SkipReason): this

// Signal session complete
plugin.complete(options?: {
  score?: number | null;
}): this

// Signal internal pause
plugin.pause(): this

// Push progress to the Host HUD
plugin.updateProgress(done: number, total: number): this

// Request a hint (Host responds via onHint callback)
plugin.requestHint(itemId: string): this

// Request iframe resize
plugin.requestResize(height: number | 'auto', width?: number | 'auto' | null): this

// Log a non-fatal error to the Host
plugin.reportError(code: string, message: string, options?: {
  itemId?: string;
  context?: Record<string, unknown>;
}): this
```

---

#### Timer utilities

```typescript
// Start a per-item stopwatch (replaces manual Date.now() tracking)
plugin.startItemTimer(itemId: string): this

// Stop the timer and return elapsed ms (also clears the timer entry)
plugin.stopItemTimer(itemId: string): number

// Stop the timer silently (without returning the value, e.g., on skip)
plugin.clearItemTimer(itemId: string): this
```

---

#### Development helpers

```typescript
// Register mock items to be used in standalone mode.
// Suppresses the built-in URL-input dialog; onInit fires after standaloneTimeout ms
// if no INIT_SESSION message arrives from a host.
plugin.useMockData(items: OQSEItem[], settings?: Partial<SessionSettings>): this

// Manually trigger onInit with mock data immediately (useful for unit tests)
plugin.triggerMock(): this

// Returns true when running outside the Memizy host (window.self === window.top)
plugin.isStandalone(): boolean
```

---

### Usage examples

#### Minimal plugin (TypeScript)

```typescript
import { MemizyPlugin, OQSEItem } from '@memizy/plugin-sdk';

const plugin = new MemizyPlugin({
  id: 'https://my-domain.com/my-quiz',
  version: '1.0.0',
});

plugin
  .useMockData([
    { id: 'q1', type: 'flashcard', question: 'What is 2+2?', answer: '4' }
  ])
  .onInit(({ items }) => {
    renderItems(items);
  });

function renderItems(items: OQSEItem[]) {
  items.forEach(item => {
    plugin.startItemTimer(item.id);
    // ... render UI
  });
}

function onUserAnswer(itemId: string, isCorrect: boolean, rawAnswer: string) {
  plugin
    .answer(itemId, isCorrect, { answer: rawAnswer })
    .updateProgress(++answeredCount, totalItems);

  if (answeredCount === totalItems) {
    plugin.complete({ score: Math.round((correctCount / totalItems) * 100) });
  }
}
```

#### Vanilla JavaScript (static HTML plugin)

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
    "capabilities": {
      "actions": ["render"],
      "types": ["flashcard", "mcq-single"]
    }
  }
  </script>
</head>
<body>
<div id="app"></div>

<script type="module">
  import { MemizyPlugin } from 'https://cdn.jsdelivr.net/npm/@memizy/plugin-sdk/dist/index.js';

  const plugin = new MemizyPlugin({
    id: 'https://my-domain.com/my-quiz',
    version: '1.0.0'
  });

  plugin
    .useMockData([{ id: 'q1', type: 'flashcard', question: 'Test?', answer: 'Yes' }])
    .onInit(({ items, settings }) => {
      console.log('Session started, locale:', settings.locale);
      renderQuestion(items[0]);
    });

  function renderQuestion(item) {
    const app = document.getElementById('app');
    app.innerHTML = `<h2>${item.question}</h2>
      <button id="btn-correct">Correct</button>
      <button id="btn-wrong">Wrong</button>`;

    plugin.startItemTimer(item.id);

    // In ES modules, use addEventListener instead of inline onclick
    document.getElementById('btn-correct').addEventListener('click', () => {
      plugin.answer(item.id, true).complete();
    });
    document.getElementById('btn-wrong').addEventListener('click', () => {
      plugin.answer(item.id, false).complete();
    });
  }
</script>
</body>
</html>
```

#### Hint flow

```typescript
plugin.onHint(({ itemId, granted, hintText, fuelCost }) => {
  if (granted && hintText) {
    showHintBubble(itemId, hintText);
    updateFuelDisplay(fuelCost); // Show cost animation
  } else {
    showNotEnoughFuelToast();
  }
});

// When user clicks "Hint" button:
function onHintButtonClick(itemId: string) {
  plugin.requestHint(itemId);
}
```

---

## Project Setup Guide

### Scaffolding a new plugin

A Memizy plugin is a self-contained static web application. The minimal project structure is:

```
my-plugin/
├── index.html          # Plugin entry point (MUST contain the manifest script tag)
├── package.json
├── tsconfig.json       # (if using TypeScript)
├── src/
│   └── main.ts
├── public/
│   └── preview.png     # 512×512 px plugin preview image for the catalog
├── README.md
└── LICENSE
```

**Step-by-step setup for a new TypeScript plugin:**

```bash
# 1. Clone the template (or scaffold manually)
git clone https://github.com/memizy/plugin-template my-plugin
cd my-plugin

# 2. Install dependencies
npm install

# 3. Install the SDK
npm install @memizy/plugin-sdk

# 4. Start the dev server
npm run dev
# The plugin opens in your browser. Because no host sends INIT_SESSION,
# the SDK fires onInit with mock data after 2 seconds automatically.

# 5. Build for production
npm run build
# Output goes to dist/. Deploy the contents of dist/ as a static site.
```

**Minimal `package.json`:**

```json
{
  "name": "memizy-plugin-my-plugin",
  "version": "1.0.0",
  "description": "A Memizy learning plugin",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@memizy/plugin-sdk": "^0.1.2"
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

Paste this into your `README.md` and fill in the blanks:

```markdown
# [Plugin Name] — Memizy Plugin

> One-sentence description of what the plugin does or teaches.

## Preview

![Preview screenshot](public/preview.png)

## Supported item types

| OQSE Type | Supported |
| :--- | :--- |
| `flashcard` | ✅ |
| `mcq-single` | ✅ |
| `short-answer` | ⬜ |

## Study mode

`drill` / `fun` / `game` *(choose one)*

## Getting started (development)

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.
The plugin will load with mock data automatically after 2 seconds.

## Building for production

```bash
npm run build
```

Deploy the contents of `dist/` as a static site (GitHub Pages, Cloudflare Pages, etc.).

## Plugin ID

`https://your-domain.com/your-plugin` (as declared in the OQSE manifest `id` field inside `index.html` — MUST be a URL or URN-UUID)

## License

[MIT](LICENSE) © [Your Name] [Year]
```

---

### License

Memizy plugins are encouraged to use the **MIT License**. Copy the text below into your `LICENSE` file, replacing `[Year]` and `[Author]`:

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
