<p align="center">
  <img src="https://memizy.com/logo.svg" height="48" alt="Memizy" />
</p>

<h1 align="center">@memizy/plugin-sdk</h1>

<p align="center">
  <b>Official TypeScript SDK for building Memizy learning plugins.</b><br/>
  RPC-first · Strongly typed · Works standalone for development.
</p>

<p align="center">
  <a href="./docs/plugin-api.md"><b>Plugin API Guide</b></a> ·
  <a href="./docs/host-protocol.md">Host Protocol</a> ·
  <a href="./example/">Live Example</a>
</p>

---

## What is this?

`@memizy/plugin-sdk` lets you build **sandboxed learning apps** (flashcards,
quizzes, games, simulators, …) that slot into the Memizy player. The SDK
handles the boring bits:

- 🔌 **Penpal v7 RPC** with the host — no manual `postMessage` plumbing.
- 🧬 **Mutative JSON patches** — mutate items with `recipe(draft => {…})`,
  the SDK sends only the delta across the iframe boundary.
- 📦 **OQSE types & Zod schemas** — all data models come from `@memizy/oqse`.
- 🧪 **Standalone dev mode** — a `sessionStorage`-backed mock host and a
  brand-aligned Shadow-DOM UI to load OQSE decks locally.

---

## Quick start

```bash
npm install @memizy/plugin-sdk
```

```ts
import { MemizySDK } from '@memizy/plugin-sdk';

const sdk = new MemizySDK({
  id: 'my-flashcard-plugin',
  version: '1.0.0',
  debug: true,
});

const { items, settings } = await sdk.connect();

console.log(`Loaded ${items.length} items.`);

sdk.store.startItemTimer(items[0].id);
sdk.store.answer(items[0].id, /* isCorrect */ true, { confidence: 3 });

await sdk.sys.requestResize(720);
await sdk.sys.exit({ score: 95 });
```

The SDK **auto-detects** its runtime environment:

- Inside an iframe → connects to the host via Penpal.
- Top-level window → spins up a local `MockHost` + Standalone UI for dev.

See the full walkthrough in [**`docs/plugin-api.md`**](./docs/plugin-api.md).

---

## Namespaced API at a glance

| Namespace        | Purpose                                                                |
|------------------|------------------------------------------------------------------------|
| `sdk.sys`        | Resize, exit, report errors.                                           |
| `sdk.store`      | Get items/meta/progress, `answer()`, `skip()`, patch-based mutations.  |
| `sdk.assets`     | Upload & fetch binary assets (`File`/`Blob`).                          |
| `sdk.text`       | Parse & render OQSE rich text (tokens, assets, blanks).                |

Full reference → [`docs/plugin-api.md`](./docs/plugin-api.md).

---

## Standalone development

When you run your plugin outside the Memizy host (e.g. on `localhost`), the
SDK shows a floating ⚙ gear that opens the **Standalone Loader** — a
brand-styled Shadow-DOM modal for loading study sets by URL, text, or
drag-and-drop.

You can also:

- Pass seed data: `sdk.connect({ mockData: { items: [...] } })`.
- Auto-load via URL parameter: `?set=https://example.com/deck.oqse.json`.
- Open the modal yourself: `sdk.openStandaloneUI()`.

Everything is validated against `@memizy/oqse` Zod schemas so malformed
input fails loudly.

---

## Live example

A minimal flashcard plugin showcasing the full SDK lives in
[`example/`](./example/) and is deployed to GitHub Pages at:

**`https://memizy.github.io/plugin-sdk/`**

Run it locally:

```bash
npm install
npm run example:dev
```

---

## Documentation

- 📘 **[Plugin API Guide](./docs/plugin-api.md)** — for plugin authors.
- 🏛️ **[Host Protocol](./docs/host-protocol.md)** — for integrators
  building hosts (Memizy Vue Player, LMS, CMS, …).

---

## License

MIT © Memizy.
