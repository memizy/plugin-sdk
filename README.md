<div align="center">

# 🛠️ Memizy Plugin API & SDK
**Build interactive study modules for the OQSE ecosystem.**

![Version](https://img.shields.io/badge/npm-v0.1.0-blue?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-success?style=for-the-badge)

</div>

---

## 💡 What is this?

Memizy host applications use a **sandboxed iframe architecture** to render study sets. This SDK provides a simple, zero-dependency JavaScript/TypeScript wrapper around the `window.postMessage` API, allowing your custom plugins to seamlessly communicate with the host application.

## 📦 Installation

```bash
npm install @memizy/plugin-sdk

```

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
