<div align="center">

# 🛠️ Memizy Plugin API & SDK
**Build interactive study modules for the OQSE ecosystem.**

![Version](https://img.shields.io/badge/npm-v0.1.2-blue?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-success?style=for-the-badge)

</div>

---

## 💡 What is this?

Memizy host applications use a **sandboxed iframe architecture** to render study sets. This SDK provides a simple, zero-dependency JavaScript/TypeScript wrapper around the `window.postMessage` API, allowing your custom plugins to seamlessly communicate with the host application.

## 📦 Installation

```bash
npm install @memizy/plugin-sdk

```

## 🧭 Standalone Mode

The SDK automatically detects when the plugin is running outside a Memizy host (i.e. opened directly in a browser tab) and enters **Standalone Mode**. The developer's `onInit` callback is called identically in all cases — no extra code is needed in the plugin.

**Priority order:**

| # | Condition | Behaviour |
|---|-----------|-----------|
| 1 | Running inside the Memizy iframe | Waits for `INIT_SESSION` postMessage from host |
| 2 | `useMockData()` was called | Fires `onInit` after `standaloneTimeout` ms if no host message arrives |
| 3 | `?set=<url>` query parameter present | Fetches the OQSE JSON from that URL and fires `onInit` automatically |
| 4 | None of the above | Injects a built-in Shadow DOM URL-input dialog where you can paste any OQSE file URL |

**Using `?set=` during development:**

```
http://localhost:5173/index.html?set=https://example.com/my-set/data.oqse.json
```

This is the recommended workflow for testing standalone plugins: serve the plugin locally and pass the study-set URL as a query parameter.

All relative `MediaObject.value` paths in `meta.assets` and `item.assets` are automatically resolved to absolute `https://` URLs using the OQSE file's base URL, so plugins always receive ready-to-use asset URLs.

## 🚀 Quick Start: Building a Simple Flashcard Player

Here is a complete example of how to build a plugin that renders a basic `flashcard`.

```javascript
import { MemizyPlugin } from '@memizy/plugin-sdk';

// 1. Initialize the SDK (id must match the OQSE manifest inside index.html)
const plugin = new MemizyPlugin({
  id: 'https://my-domain.com/simple-flashcard',
  version: '1.0.0',
});

// 2. (Optional) Provide mock data for development outside the Memizy host
plugin.useMockData([
  { id: 'q1', type: 'flashcard', front: 'Hello', back: 'World' },
]);

// 3. Listen for the session to start and render items
plugin.onInit(({ items }) => {
  const item = items[0];
  plugin.startItemTimer(item.id);

  document.getElementById('front-text').textContent = item.front;
  document.getElementById('back-text').textContent = item.back;

  // 4. Report the result when the user clicks a button
  document.getElementById('btn-correct').addEventListener('click', () => {
    plugin.answer(item.id, true).complete();
  });

  document.getElementById('btn-wrong').addEventListener('click', () => {
    plugin.answer(item.id, false).complete();
  });
});
```

## 📚 Documentation

For more details on the Manifest structure and advanced capabilities, please refer to the [OQSE Specification](https://github.com/memizy/oqse-specification).

<div align="center">
<i>Maintained with ❤️ by the Memizy Team.</i>
</div>
