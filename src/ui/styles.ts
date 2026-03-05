/**
 * CSS injected into the closed Shadow DOM for the standalone mode UI.
 * Matches the Memizy brand: orange `#FF6B00` primary, white cards, clean type.
 */
export const STANDALONE_UI_CSS = `
:host {
  all: initial;
  display: contents;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #1f2937;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
*, *::before, *::after { box-sizing: border-box; }

/* ── Gear button ── */
.gear-btn {
  position: fixed;
  bottom: 16px;
  right: 16px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: #fff;
  border: 1px solid #e5e7eb;
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  opacity: 0.5;
  transition: opacity 0.2s, box-shadow 0.2s, transform 0.2s;
  z-index: 2147483646;
  color: #ff6b00;
  padding: 0;
  margin: 0;
}
.gear-btn:hover {
  opacity: 1;
  box-shadow: 0 4px 16px rgba(0,0,0,0.18);
  transform: rotate(30deg);
}

/* ── Modal overlay ── */
.overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.45);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}
.overlay.hidden { display: none; }

/* ── Card ── */
.card {
  background: #fff;
  border-radius: 16px;
  width: min(520px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0,0,0,0.25);
  color: #1f2937;
}

/* ── Header ── */
.header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 24px 0;
}
.header .logo { font-size: 1.5rem; line-height: 1; }
.header h2 {
  flex: 1;
  margin: 0;
  font-size: 1.1rem;
  font-weight: 700;
  color: #1f2937;
}
.header h2 span { color: #9ca3af; font-weight: 400; }
.close-btn {
  background: none;
  border: none;
  font: inherit;
  font-size: 1.4rem;
  color: #9ca3af;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
  line-height: 1;
  transition: color 0.15s, background 0.15s;
}
.close-btn:hover { color: #1f2937; background: #f3f4f6; }

/* ── Tabs ── */
.tabs {
  display: flex;
  border-bottom: 1px solid #e5e7eb;
  padding: 0 24px;
  margin-top: 16px;
}
.tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  font: inherit;
  padding: 10px 16px;
  font-size: 0.88rem;
  font-weight: 500;
  color: #6b7280;
  cursor: pointer;
  margin-bottom: -1px;
  transition: color 0.15s, border-color 0.15s;
}
.tab:hover { color: #1f2937; }
.tab.active { color: #ff6b00; border-bottom-color: #ff6b00; font-weight: 600; }

/* ── Tab body ── */
.tab-body { padding: 20px 24px 24px; }
.tab-body.hidden { display: none; }

/* ── Section / label ── */
.section { margin-bottom: 14px; }
.section:last-child { margin-bottom: 0; }
label { display: block; font-size: 0.82rem; font-weight: 600; color: #374151; margin-bottom: 6px; }

/* ── Inputs ── */
input[type="url"], input[type="text"] {
  width: 100%;
  padding: 10px 12px;
  background: #f9fafb;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  color: #1f2937;
  font: inherit;
  font-size: 0.9rem;
  outline: none;
  min-width: 0;
  transition: border-color 0.15s;
}
input:focus { border-color: #ff6b00; }
input::placeholder { color: #9ca3af; }
textarea {
  display: block;
  width: 100%;
  padding: 10px 12px;
  background: #f9fafb;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  color: #1f2937;
  font-family: 'SF Mono', 'Cascadia Code', Consolas, monospace;
  font-size: 0.82rem;
  outline: none;
  resize: vertical;
  min-height: 76px;
  transition: border-color 0.15s;
}
textarea:focus { border-color: #ff6b00; }
textarea::placeholder { color: #9ca3af; }

/* ── Buttons ── */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  min-width: 44px;
  min-height: 40px;
  transition: background 0.15s, opacity 0.15s;
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary { background: #ff6b00; color: #fff; }
.btn-primary:hover:not(:disabled) { background: #e65c00; }
.btn-secondary { background: #f3f4f6; color: #374151; }
.btn-secondary:hover:not(:disabled) { background: #e5e7eb; }
.btn-sm { padding: 7px 14px; font-size: 0.84rem; min-height: 34px; }
.btn-full { width: 100%; }

/* ── Row ── */
.row { display: flex; gap: 8px; align-items: stretch; }
.row input[type="url"] { flex: 1; }

/* ── Divider ── */
.divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 14px 0;
  color: #9ca3af;
  font-size: 0.78rem;
}
.divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: #e5e7eb; }

/* ── Drop zone ── */
.drop-zone {
  border: 2px dashed #d1d5db;
  border-radius: 10px;
  padding: 18px;
  text-align: center;
  cursor: pointer;
  color: #6b7280;
  font-size: 0.85rem;
  transition: border-color 0.15s, background 0.15s;
  line-height: 1.5;
}
.drop-zone:hover, .drop-zone.drag-over { border-color: #ff6b00; background: #fff7ed; }
.drop-zone .dz-icon { font-size: 1.3rem; margin-bottom: 4px; display: block; }

/* ── Status ── */
.status-bar { padding: 0 24px 4px; min-height: 1.3em; font-size: 0.83rem; }
.status-bar.s-error { color: #ef4444; }
.status-bar.s-ok    { color: #10b981; }
.status-bar.s-info  { color: #6b7280; }

/* ── Hint ── */
.hint { padding: 6px 24px 18px; font-size: 0.76rem; color: #9ca3af; text-align: center; }
code {
  background: #f3f4f6;
  padding: 1px 5px;
  border-radius: 4px;
  font-family: 'SF Mono', 'Cascadia Code', Consolas, monospace;
  font-size: 0.82em;
}

/* ── Progress loaded indicator ── */
.progress-ok {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 0.85rem;
  color: #166534;
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}
`;
