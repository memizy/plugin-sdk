# Plugin API Guide

> Audience: developers building a **Memizy learning plugin** — a flashcard
> deck, quiz game, simulator, etc. — that will be embedded in the Memizy
> player (or a compatible host) via an `<iframe>`.
>
> Building a host instead? See [`host-protocol.md`](./host-protocol.md).

---

## 1. Installation

```bash
npm install @memizy/plugin-sdk
```

The SDK has three runtime dependencies, all of which are auto-externalised
by our Vite config:

- [`penpal`](https://github.com/Aaronius/penpal) — iframe ↔ host RPC.
- [`mutative`](https://github.com/unadlib/mutative) — JSON patch generation.
- [`@memizy/oqse`](https://github.com/memizy/oqse) — types, schemas, rich-text helpers.

Everything you need is re-exported from `@memizy/plugin-sdk` — you rarely
need to import from `@memizy/oqse` directly.

---

## 2. Construct & connect

```ts
import { MemizySDK } from '@memizy/plugin-sdk';

const sdk = new MemizySDK({
  id: 'com.example.my-flashcard-plugin', // must be unique per plugin
  version: '1.0.0',
  debug: true,                           // optional — console.log lifecycle
});

const session = await sdk.connect();

console.log(session.items.length, 'items');
console.log(session.settings.theme);   // 'light' | 'dark' | 'system'
```

`connect()` returns the `InitSessionPayload` returned by the host's
`sysInit()`. The namespaced managers are available only **after**
`connect()` resolves — accessing `sdk.store` before that throws.

### 2.1 All constructor options

```ts
interface MemizySDKOptions {
  id: string;                        // required
  version: string;                   // required
  allowedOrigins?: (string|RegExp)[];// Penpal allow-list. Default: ['*'].
  handshakeTimeout?: number;         // ms. Default 10_000.
  debug?: boolean;                   // Default false.
  // Standalone-only (ignored in iframe mode):
  standaloneControlsMode?: 'auto' | 'hidden';
  standaloneUiPosition?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
}
```

### 2.2 `connect()` options

```ts
await sdk.connect({
  mockData: { items, setMeta, progress, assets, settings },
  mode: 'auto', // 'auto' | 'iframe' | 'standalone'
});
```

- `mockData` — seed data used only in standalone mode.
- `mode` — override the auto-detection. Production plugins should stick
  with `'auto'`.

---

## 3. The namespaced API

### 3.1 `sdk.sys` — system actions

```ts
await sdk.sys.requestResize(720);          // height in px (number | 'auto')
await sdk.sys.requestResize(720, 960);     // + width
await sdk.sys.exit({ score: 85 });         // 0..100
await sdk.sys.reportError('bad-input', 'User entered NaN', {
  itemId: 'item-001',
  context: { input: rawValue },
});

sdk.sys.elapsedMs; // ms since sysInit resolved
```

### 3.2 `sdk.store` — state + mutations

#### Accessors (synchronous, local snapshot)

```ts
sdk.store.getItems();          // OQSEItem[]
sdk.store.getItem(id);         // OQSEItem | undefined
sdk.store.getMeta();           // OQSEMeta | undefined
sdk.store.getProgress();       // Record<string, ProgressRecord>
```

#### Answering & skipping (Leitner reducer)

```ts
sdk.store.startItemTimer(itemId);     // starts the stopwatch

// … user interacts …

sdk.store.answer(itemId, true, {
  confidence: 3,       // 1..4 (optional)
  hintsUsed: 1,        // default 0
  // timeSpent omitted → auto-read from the timer
});
// ⇒ next ProgressRecord; bucket/stats/lastAnswer updated.

sdk.store.skip(itemId);
```

The Leitner intervals are `{0: 0, 1: 1, 2: 3, 3: 7, 4: 30}` days. You can
import the constant (`LEITNER_INTERVALS_DAYS`) and the pure reducer
(`defaultLeitnerReducer`) if you want to implement your own flow.

#### Safe item mutations with `updateItem`

Use a **recipe callback** — the SDK runs it through mutative, generates
JSON patches, and ships only the delta to the host:

```ts
await sdk.store.updateItem(itemId, (item) => {
  item.title = 'Updated title';
  if (item.type === 'flashcard') {
    item.back += ' (edited)';
  }
});
```

Never mutate the object returned by `getItem(...)` directly — the SDK has
no way to see those changes.

#### Creating & deleting items

```ts
await sdk.store.createItem({
  id: 'item-new-42',
  type: 'flashcard',
  front: 'Hello',
  back: 'World',
});

await sdk.store.deleteItem('item-new-42');
```

#### Updating meta

```ts
await sdk.store.updateMeta((meta) => {
  meta.title = 'My Deck';
  meta.description = 'Updated.';
});
```

#### Bulk progress sync

```ts
await sdk.store.syncProgress({
  'item-a': {
    bucket: 2,
    stats: { attempts: 3, incorrect: 1, streak: 2 },
  },
});
```

### 3.3 `sdk.assets` — binary bridge

```ts
const file = fileInput.files![0];
const media = await sdk.assets.upload(file, 'cover.png');
// ⇒ MediaObject { type, value, mimeType, ... }

const raw = await sdk.assets.getRaw('cover.png'); // File | Blob

sdk.assets.get('cover.png');   // sync lookup of already-known asset
sdk.assets.all();              // all session-known assets
```

Both `File` and `Blob` are transferred via Penpal's structured-clone
layer — no base64, no manual chunking.

### 3.4 `sdk.text` — rich text

OQSE allows content like:

```
The mitochondrion is the <blank:answer /> of the cell.
See diagram: <asset:mito-diagram />
```

#### Render HTML

```ts
import DOMPurify from 'dompurify';
import { marked } from 'marked';

const html = sdk.text.renderHtml(item.front, {
  markdownParser: (s) => marked.parse(s) as string,
  sanitizer: (html) => DOMPurify.sanitize(html),
});

container.innerHTML = html;
```

The default renderer:

- Replaces `<asset:key />` with `<img>`/`<audio>`/`<video>` using the
  current session's assets.
- Replaces `<blank:key />` with an `<input class="oqse-blank">`.
- Passes markdown through `markdownParser` (no-op if omitted).
- Passes the whole thing through `sanitizer` (**strongly recommended**).

> ⚠️ Without a sanitizer, the output is unsafe HTML. Always plug
> [DOMPurify](https://github.com/cure53/DOMPurify) or similar.

#### Parse tokens manually

```ts
for (const tok of sdk.text.parseTokens(item.front)) {
  switch (tok.type) {
    case 'text':  renderText(tok.value); break;
    case 'asset': renderAsset(tok.key, tok.media); break;
    case 'blank': renderInput(tok.key); break;
  }
}
```

---

## 4. Lifecycle callbacks

```ts
sdk.onConfigUpdate((config) => {
  if (config.theme) applyTheme(config.theme);
  if (config.locale) setLocale(config.locale);
});

sdk.onSessionAborted((reason) => {
  // 'user_exit' | 'timeout' | 'host_error'
  showGoodbyeScreen(reason);
});
```

Both callbacks can be chained on construction:

```ts
new MemizySDK({ id, version })
  .onConfigUpdate(applyConfig)
  .onSessionAborted(handleAbort);
```

---

## 5. Standalone mode

When the iframe is actually the top-level window (e.g. you ran
`npm run dev` and opened `http://localhost:5173/`), the SDK switches to
**standalone mode**.

You have three non-exclusive ways to feed it data:

### 5.1 `mockData` — in-code seed

```ts
import SAMPLE from './sample.json';

await sdk.connect({ mockData: { items: SAMPLE.items } });
```

Great for local dev where the deck doesn't change.

### 5.2 `?set=` — URL auto-loader

```
http://localhost:5173/?set=https://example.com/deck.oqse.json
```

The SDK fetches the URL, validates the response, and passes it straight
to `sysInit()`. Useful for quickly switching decks via bookmarklets.

### 5.3 The built-in Standalone UI

If neither `mockData` nor `?set=` is provided, the SDK shows a
brand-aligned modal with:

- **Study Set** tab — URL / textarea / drag-and-drop for `.json`.
- **Progress** tab — textarea / drag-and-drop for `.oqsep`.

`connect()` **waits** until the user submits a valid OQSE payload, then
resolves. A floating ⚙ gear stays on-screen so you can swap decks or
drop in saved progress mid-session.

Options:

```ts
new MemizySDK({
  id, version,
  standaloneControlsMode: 'auto',        // or 'hidden'
  standaloneUiPosition:   'bottom-right', // or any corner
});

// Later, if you went with 'hidden' or want a custom trigger:
sdk.openStandaloneUI();
```

The UI lives in a **closed Shadow Root**, so its CSS can never leak into
your plugin and your CSS can never style its internals.

### 5.4 Session persistence

Everything in standalone mode is persisted to `sessionStorage` under
`memizy.plugin-sdk.standalone.v0.3`. Refresh the tab and your state
(items + mutations + progress) comes back. Close the tab to wipe it.

---

## 6. Error handling

```ts
try {
  await sdk.connect();
} catch (err) {
  // Penpal handshake failure, host-side validation error, timeout, …
  console.error('Failed to connect:', err);
}

try {
  await sdk.store.updateItem(id, (draft) => {
    draft.answer = formValue;
  });
} catch (err) {
  // Host rejected the patch (e.g. schema validation).
  sdk.sys.reportError('bad-update', String(err), { itemId: id });
}
```

In general, if the host throws from a handler, Penpal forwards the
rejection back to the plugin — so `await`-ed SDK methods will reject.

---

## 7. Tree-shakable helpers

These are exported from the SDK root for convenience:

```ts
import {
  MemizySDK,
  // Leitner
  defaultLeitnerReducer,
  LEITNER_INTERVALS_DAYS,
  // Rich text
  prepareRichTextForDisplay,
  tokenizeOqseTags,
  // Validation (re-exported from @memizy/oqse)
  OQSEItemSchema,
  safeValidateOQSEItem,
  // Type guards
  isFlashcard,
  isMcqSingle,
} from '@memizy/plugin-sdk';
```

---

## 8. TypeScript tips

Every OQSE item type is exhaustively narrowable via the re-exported
guards:

```ts
import type { OQSEItem } from '@memizy/plugin-sdk';
import { isFlashcard, isMcqSingle } from '@memizy/plugin-sdk';

function render(item: OQSEItem) {
  if (isFlashcard(item)) return renderFlashcard(item.front, item.back);
  if (isMcqSingle(item)) return renderMcq(item.question, item.options);
  return renderFallback(item);
}
```

---

## 9. Security recommendations

- Sanitize every raw-text render with DOMPurify (or equivalent).
- Use `allowedOrigins: [/^https:\/\/memizy\.com$/]` in production.
- Never trust user-controlled input as a `suggestedKey` for
  `assets.upload` — the host enforces size/MIME limits, but your UI
  should too.

---

## 10. Full example

See [`example/`](../example/) for a complete, styled, GitHub-Pages-ready
plugin that demonstrates every namespace.
