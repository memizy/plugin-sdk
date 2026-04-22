# Flashcard Example — @memizy/plugin-sdk

A minimal, brand-aligned plugin that demonstrates the full surface of the
`@memizy/plugin-sdk`:

- ⚙️ SDK construction & `await sdk.connect({ mockData })`
- 📚 `sdk.store` — items, progress, `answer()` / `skip()`, timers
- ✍️ `sdk.text.renderHtml(...)` for rich OQSE content (assets + blanks)
- 🧩 `sdk.sys` — resize hint & exit with score
- 🪟 Built-in Standalone UI (gear + modal) for loading OQSE / OQSEP files
- 🔄 Lifecycle hooks (`onConfigUpdate`, `onSessionAborted`)

## Run it locally

From the repository root:

```bash
npm install
npm run example:dev
```

Open the URL Vite prints (usually `http://localhost:5173`). The ⚙ gear
in the top-right opens the Standalone Loader — load your own `.json`
or `.oqsep` files there.

Tip: append `?set=<url>` to the page URL to auto-load a remote OQSE set.

## Build for GitHub Pages

```bash
npm run example:build
```

The static bundle lands in `example/dist/` ready to deploy. The repository
ships a workflow (`.github/workflows/pages.yml`) that does this
automatically on every push to `main`.

## Files

| File                   | What it does |
|------------------------|--------------|
| `index.html`           | Layout + branding. |
| `style.css`            | Brand tokens, card layout, buckets. |
| `src/main.ts`          | Plugin logic — wires the SDK to the DOM. |
| `src/sample-set.ts`    | Tiny demo OQSE items & assets. |
| `vite.config.ts`       | Dev server + GH-Pages base-path. |
