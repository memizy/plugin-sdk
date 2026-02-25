// src/index.js

export class MemizyPlugin {
  constructor(manifest) {
    this.manifest = manifest;
    this.onRenderCallback = null;
    
    // Začneme poslouchat zprávy od hlavní aplikace
    window.addEventListener('message', this._handleMessage.bind(this));
  }

  _handleMessage(event) {
    const { type, payload } = event.data;

    // Hlavní aplikace nám poslala data (otázku), kterou máme vykreslit
    if (type === 'OQSE_RENDER_ITEM' && this.onRenderCallback) {
      this.onRenderCallback(payload.item, payload.context);
    }
  }

  // 1. Vývojář zavolá toto, když je plugin načtený (Handshake)
  connect() {
    window.parent.postMessage({
      type: 'PLUGIN_READY',
      manifest: this.manifest
    }, '*');
  }

  // 2. Vývojář definuje, co se má stát, když přijde otázka
  onRender(callback) {
    this.onRenderCallback = callback;
  }

  // 3. Vývojář zavolá toto, když uživatel odpoví (např. klikne na tlačítko)
  submitResult(score, feedback = "") {
    window.parent.postMessage({
      type: 'ITEM_SCORED',
      payload: { score, feedback }
    }, '*');
  }
}
