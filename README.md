# Memizy Plugin SDK

Official TypeScript SDK for building Memizy plugins on top of the OQSE ecosystem.

![Version](https://img.shields.io/badge/npm-v0.2.1-blue)
![License](https://img.shields.io/badge/License-MIT-success)

## Overview

Memizy plugins run inside a sandboxed iframe and communicate with the host via a typed `postMessage` protocol. The SDK provides:

Lightweight and fully typed, built directly on top of the `@memizy/oqse` core.

- lifecycle handshake (`PLUGIN_READY` -> `INIT_SESSION`)
- internal Leitner progress reducer with automatic `SYNC_PROGRESS`
- CRUD helpers for item and metadata mutation
- host-bridged asset upload/download methods
- standalone development mode with built-in loading UI

## Installation

```bash
npm install @memizy/plugin-sdk
```

CDN (static plugin projects):

```html
<script type="module">
  import { MemizyPlugin } from 'https://cdn.jsdelivr.net/npm/@memizy/plugin-sdk@0.2.1/dist/memizy-sdk.js';
</script>
```

## Quick Start

```typescript
import { MemizyPlugin } from '@memizy/plugin-sdk';
import type { InitSessionPayload, OQSEItem } from '@memizy/plugin-sdk';

const plugin = new MemizyPlugin({
  id: 'https://my-domain.com/my-plugin',
  version: '1.0.0',
  debug: true,
  standaloneControlsMode: 'auto', // 'auto' | 'hidden'
});

let items: OQSEItem[] = [];
let cursor = 0;

plugin.onInit((payload: InitSessionPayload) => {
  items = payload.items;
  render(items[cursor]!);
});

function render(item: OQSEItem): void {
  plugin.startItemTimer(item.id);
}
```

## Standalone Controls Mode

Standalone mode is a lightweight development environment focused on DX and fast Vite HMR loops.

State model:

- one active set + progress are kept in `sessionStorage` under `memizy_dev_state`
- state survives page reloads within the current browser tab to preserve HMR flow
- state is ephemeral and intended for development/testing

Control modes:

- `auto` (default): floating gear is visible and the dialog auto-opens when no set is loaded
- `hidden`: no gear icon; open dialog programmatically when needed

```typescript
const plugin = new MemizyPlugin({
  id: 'https://my-domain.com/my-plugin',
  version: '1.0.0',
  standaloneControlsMode: 'hidden',
});

plugin.openStandaloneControls();
```

### Local Asset Testing in Standalone

For local development, prefer one of these patterns:

- use absolute URLs in JSON assets (for example `http://localhost:5173/image.png`)
- inject assets via `plugin.useMockData()`
- test the upload flow with `uploadAsset()`, which creates session-local `blob:` URLs in standalone mode

If your plugin needs richer local persistence for its own feature set, implement it in plugin code with standard browser APIs (`localStorage` / `IndexedDB`). The SDK stays focused on host communication and runtime bridge behavior.

## Text Processing API

The SDK includes a text processing layer designed for both rapid integration and advanced rendering pipelines.

### `renderHtml()` - Unsafe vs Sanitized HTML

Use `renderHtml()` when you want fast integration in Vanilla JS or simple template-driven UIs.

- returns a basic HTML string
- resolves `<asset:key />` using the current session asset registry
- renders `<blank:key />` as input fields
- without a sanitizer, output is unsafe and MUST be sanitized before display
- with a sanitizer, output has already been sanitized by your provided policy

```typescript
const html = plugin.renderHtml(rawText, {
  markdownParser: (text) => marked.parse(text) as string,
  sanitizer: (unsafeHtml) => DOMPurify.sanitize(unsafeHtml),
});
target.innerHTML = html;
```

### `parseTextTokens()` - Tokenized Rendering

Use `parseTextTokens()` when building framework-native rendering in React, Vue, Svelte, or custom component systems.

- returns structured tokens (`text`, `blank`, `asset`)
- asset tokens include resolved `MediaObject` when available
- enables deterministic component mapping and custom UI logic
- tokens are data, not sanitized HTML; escape or sanitize token text before HTML display

```typescript
const tokens = plugin.parseTextTokens(rawText);

for (const token of tokens) {
  if (token.type === 'asset') {
    // map to framework component
  }
}
```

### Security and Sanitization

> [!WARNING]
> `renderHtml()` does not sanitize output by default.
> This is intentional (Inversion of Control): the SDK leaves sanitization policy to the plugin.
> Treat output as unsafe unless sanitized. Always provide your own sanitizer (for example, DOMPurify) before assigning HTML to the DOM.

## Asset Bridge and Session Assets

Plugins cannot directly access host storage in a cross-origin iframe. Use:

- `uploadAsset(file, suggestedKey?)`
- `getRawAsset(key)`

At session startup, the SDK stores `INIT_SESSION.payload.assets` in an internal session asset map. Text APIs (`parseTextTokens` and `renderHtml`) resolve `<asset:key />` tags against this map so asset references are immediately usable in rendering.

## Core API Summary

| Method | Description |
|---|---|
| `onInit(handler)` | Receives `INIT_SESSION` payload and starts plugin runtime. |
| `onConfigUpdate(handler)` | Receives runtime theme/locale updates. |
| `answer(id, isCorrect, opts?)` | Applies Leitner reducer and sends `SYNC_PROGRESS`. |
| `skip(id)` | Marks skip and sends `SYNC_PROGRESS`. |
| `syncProgress(records)` | Bulk merges and pushes progress state. |
| `saveItems(items)` | Persists item create/update via host. |
| `deleteItems(ids)` | Deletes items via host. |
| `updateMeta(meta)` | Updates set metadata via host. |
| `uploadAsset(file, key?)` | Stores asset via host and returns `MediaObject`. |
| `getRawAsset(key)` | Fetches stored raw asset as `File | Blob`. |
| `parseTextTokens(rawText)` | Returns token stream for custom renderers. |
| `renderHtml(rawText, options?)` | Returns baseline HTML with resolved tokens. |
| `openStandaloneControls()` | Opens standalone loader dialog when controls mode is `hidden`. |
| `exit(options?)` | Sends `EXIT_REQUEST` with score/time payload. |

## Documentation

- Full API and protocol reference: [plugin-sdk-api.md](plugin-sdk-api.md)
- OQSE core specification: [memizy/oqse-specification/oqse.md](https://github.com/memizy/oqse-specification/blob/main/oqse.md)
- OQSE manifest specification: [memizy/oqse-specification/oqse-manifest.md](https://github.com/memizy/oqse-specification/blob/main/oqse-manifest.md)
- OQSE progress specification: [memizy/oqse-specification/oqse-progress.md](https://github.com/memizy/oqse-specification/blob/main/oqse-progress.md)

## License

MIT
