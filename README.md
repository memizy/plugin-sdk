<h1 align="center">✨ <code>@memizy/plugin-sdk</code></h1>

<p align="center">
  <b>Official TypeScript SDK for building premium Memizy learning plugins.</b><br/>
  RPC-first · Type-safe by default · Standalone-friendly developer UX.
</p>

> Build sandboxed flashcards, quizzes, games, and interactive study tools that plug into the Memizy host with clean contracts and modern DX.

## 🚀 Live Interactive Playground

<p>
  <a href="https://memizy.github.io/plugin-sdk/"><b>🌍 Open the Live Interactive Playground ↗</b></a>
</p>

Use it to explore the full SDK in action: standalone loading, set editing, asset flows, text rendering, and progress lifecycle behavior.

<p align="center">
  <a href="./docs/plugin-api.md"><b>Plugin API Guide</b></a> ·
  <a href="./docs/host-protocol.md">Host Protocol</a> ·
  <a href="https://memizy.github.io/plugin-sdk/"><b>Playground</b></a>
</p>

---

## Why `@memizy/plugin-sdk`?

`@memizy/plugin-sdk` removes the infrastructure friction so you can focus on learning UX:

- 🔌 **Penpal v7 RPC transport** — structured host communication without manual `postMessage` wiring.
- 🧬 **Mutative JSON patches** — update items with `recipe(draft => { ... })` and send only compact deltas.
- 📦 **OQSE + Zod contracts** — shared schemas from `@memizy/oqse` keep set/progress data strongly validated.
- 🧪 **Standalone mode built in** — `sessionStorage`-backed MockHost + polished Shadow-DOM loader for local iteration.

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
