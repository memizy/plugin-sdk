<div align="center">

# 🛠️ Memizy Plugin API & SDK
**Build interactive study modules for the OQSE ecosystem.**

![Version](https://img.shields.io/badge/npm-v1.0.0-blue?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-success?style=for-the-badge)

</div>

---

## 💡 What is this?

Memizy host applications use a **sandboxed iframe architecture** to render study sets. This SDK provides a simple, zero-dependency JavaScript/TypeScript wrapper around the `window.postMessage` API, allowing your custom plugins to seamlessly communicate with the host application.

## 📦 Installation

*(Assuming this will be published to npm)*
```bash
npm install @memizy/plugin-api

```

## 🚀 Quick Start: Building a Simple Flashcard Player

Here is a complete example of how to build a plugin that renders a basic `flashcard`.

```javascript
import { MemizyPlugin } from '@memizy/plugin-api';

// 1. Define your Capability Manifest
const manifest = {
  id: "[https://my-domain.com/simple-flashcard](https://my-domain.com/simple-flashcard)",
  appName: "Simple Flashcard Viewer",
  capabilities: {
    actions: ["render"],
    types: ["flashcard"]
  }
};

// 2. Initialize the SDK
const plugin = new MemizyPlugin(manifest);

// 3. Listen for incoming items from the Host App
plugin.onRender((item) => {
  // item is the raw OQSE JSON object
  document.getElementById('front-text').innerHTML = item.front;
  document.getElementById('back-text').innerHTML = item.back;
});

// 4. Send results back to the Host App when the user clicks a button
document.getElementById('btn-correct').addEventListener('click', () => {
  plugin.submitResult(1.0); // 1.0 = 100% correct
});

document.getElementById('btn-wrong').addEventListener('click', () => {
  plugin.submitResult(0.0); // 0.0 = completely wrong
});

// 5. Tell the Host App we are ready!
plugin.connect();

```

## 📚 Documentation

For more details on the Manifest structure and advanced capabilities, please refer to the [OQSE Specification](https://www.google.com/search?q=https://github.com/memizy/oqse-specification).

<div align="center">
<i>Maintained with ❤️ by the Memizy Team.</i>
</div>
