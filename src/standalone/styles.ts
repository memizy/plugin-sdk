/**
 * Shadow-DOM CSS for the Standalone Mode UI.
 *
 * Brand palette:
 *   Orange  #FF6F00 / hover #E65100 / gradient 135deg #FF6F00 → #FF8F00
 *   Blue    #1E88E5
 *   App bg  #F8F9FA   Card bg #FFFFFF
 *   Text    #212529 (h) / #6C757D (muted)
 *   Shadow  0 4px 24px rgba(0,0,0,.08)
 *   Radii   16px cards / 12px medium / 8px inputs
 *
 * Everything is scoped by `:host` + component classes so nothing leaks out
 * of the closed Shadow Root.
 */
export const STANDALONE_UI_CSS = /* css */ `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

:host {
  all: initial;
  display: contents;
  font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color: #212529;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
*, *::before, *::after { box-sizing: border-box; }

/* ── Floating gear ───────────────────────────────────────────────────── */
.mz-gear {
  position: fixed;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #ffffff;
  color: #FF6F00;
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  line-height: 1;
  padding: 0;
  z-index: 2147483646;
  opacity: 0.85;
  transition:
    opacity 0.2s ease,
    transform 0.25s cubic-bezier(.2,.8,.2,1.2),
    box-shadow 0.2s ease,
    background 0.2s ease;
}
.mz-gear:hover {
  opacity: 1;
  transform: scale(1.08) rotate(18deg);
  box-shadow: 0 8px 24px rgba(255, 111, 0, 0.22);
  background: #FFF7ED;
}
.mz-gear:active { transform: scale(0.96) rotate(18deg); }
.mz-gear:focus-visible {
  outline: 3px solid rgba(30, 136, 229, 0.35);
  outline-offset: 2px;
}
.mz-gear[data-pos="bottom-right"] { bottom: 20px; right: 20px; }
.mz-gear[data-pos="bottom-left"]  { bottom: 20px; left:  20px; }
.mz-gear[data-pos="top-right"]    { top:    20px; right: 20px; }
.mz-gear[data-pos="top-left"]     { top:    20px; left:  20px; }

/* ── Modal overlay ───────────────────────────────────────────────────── */
.mz-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(17, 24, 39, 0.45);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  animation: mz-overlay-in 0.18s ease-out;
}
.mz-overlay.mz-hidden { display: none; }
@keyframes mz-overlay-in { from { opacity: 0; } to { opacity: 1; } }

/* ── Card ────────────────────────────────────────────────────────────── */
.mz-card {
  width: min(560px, 100%);
  max-height: min(90vh, 720px);
  background: #FFFFFF;
  border-radius: 16px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08), 0 12px 48px rgba(0, 0, 0, 0.12);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  animation: mz-card-in 0.22s cubic-bezier(.2,.8,.2,1);
}
@keyframes mz-card-in {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to   { opacity: 1; transform: none; }
}

/* ── Header ──────────────────────────────────────────────────────────── */
.mz-header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 20px 24px 16px;
  border-bottom: 1px solid #F1F3F5;
}
.mz-logo {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: linear-gradient(135deg, #FF6F00 0%, #FF8F00 100%);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 18px;
  letter-spacing: -0.02em;
  box-shadow: 0 4px 12px rgba(255, 111, 0, 0.28);
  flex-shrink: 0;
}
.mz-title { flex: 1; min-width: 0; }
.mz-title h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #212529;
  letter-spacing: -0.01em;
}
.mz-title p {
  margin: 2px 0 0;
  font-size: 13px;
  color: #6C757D;
}
.mz-close {
  background: none;
  border: none;
  font: inherit;
  font-size: 22px;
  line-height: 1;
  color: #6C757D;
  cursor: pointer;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.mz-close:hover { background: #F1F3F5; color: #212529; }

/* ── Tabs ────────────────────────────────────────────────────────────── */
.mz-tabs {
  display: flex;
  gap: 4px;
  padding: 12px 16px 0;
  background: #F8F9FA;
  border-bottom: 1px solid #F1F3F5;
}
.mz-tab {
  appearance: none;
  background: none;
  border: none;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: #6C757D;
  padding: 10px 16px;
  border-radius: 10px 10px 0 0;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  position: relative;
  transition: color 0.15s, background 0.15s;
}
.mz-tab:hover { color: #212529; }
.mz-tab[aria-selected="true"] {
  color: #FF6F00;
  background: #FFFFFF;
  box-shadow: 0 -1px 0 0 #FFFFFF inset;
}
.mz-tab[aria-selected="true"]::after {
  content: '';
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: -1px;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: linear-gradient(135deg, #FF6F00 0%, #FF8F00 100%);
}

/* ── Body ────────────────────────────────────────────────────────────── */
.mz-body {
  padding: 20px 24px 8px;
  overflow-y: auto;
  flex: 1 1 auto;
}
.mz-panel { display: flex; flex-direction: column; gap: 18px; }
.mz-panel.mz-hidden { display: none; }

.mz-section { display: flex; flex-direction: column; gap: 8px; }
.mz-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 700;
  color: #495057;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.mz-label .mz-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #FF6F00;
}

.mz-row { display: flex; gap: 8px; align-items: stretch; }
.mz-row > .mz-input { flex: 1; min-width: 0; }

/* ── Inputs ──────────────────────────────────────────────────────────── */
.mz-input,
.mz-textarea {
  width: 100%;
  padding: 11px 13px;
  font: inherit;
  font-size: 14px;
  color: #212529;
  background: #F8F9FA;
  border: 1px solid #E9ECEF;
  border-radius: 8px;
  outline: none;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
  min-width: 0;
}
.mz-input::placeholder,
.mz-textarea::placeholder { color: #ADB5BD; }
.mz-input:hover,
.mz-textarea:hover { border-color: #DEE2E6; background: #FFFFFF; }
.mz-input:focus,
.mz-textarea:focus {
  border-color: #FF6F00;
  background: #FFFFFF;
  box-shadow: 0 0 0 3px rgba(255, 111, 0, 0.12);
}
.mz-textarea {
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, ui-monospace, monospace;
  font-size: 12.5px;
  line-height: 1.5;
  min-height: 104px;
  resize: vertical;
}

/* ── Buttons ─────────────────────────────────────────────────────────── */
.mz-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 18px;
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition:
    background 0.15s,
    box-shadow 0.15s,
    transform 0.1s,
    color 0.15s,
    border-color 0.15s;
  white-space: nowrap;
}
.mz-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.mz-btn:not(:disabled):active { transform: translateY(1px); }

.mz-btn-primary {
  background: linear-gradient(135deg, #FF6F00 0%, #FF8F00 100%);
  color: #fff;
  box-shadow: 0 4px 12px rgba(255, 111, 0, 0.24);
}
.mz-btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #E65100 0%, #FF6F00 100%);
  box-shadow: 0 6px 16px rgba(255, 111, 0, 0.32);
}

.mz-btn-secondary {
  background: #FFFFFF;
  color: #212529;
  border-color: #E9ECEF;
}
.mz-btn-secondary:hover:not(:disabled) {
  background: #F8F9FA;
  border-color: #DEE2E6;
}

.mz-btn-ghost {
  background: transparent;
  color: #6C757D;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
}
.mz-btn-ghost:hover:not(:disabled) { color: #212529; background: #F1F3F5; }

.mz-btn-full { width: 100%; }
.mz-btn .mz-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: mz-spin 0.7s linear infinite;
}
@keyframes mz-spin { to { transform: rotate(360deg); } }

/* ── Drop zone ───────────────────────────────────────────────────────── */
.mz-drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 22px 16px;
  border: 2px dashed #DEE2E6;
  border-radius: 12px;
  color: #6C757D;
  background: #F8F9FA;
  cursor: pointer;
  text-align: center;
  font-size: 13px;
  transition: border-color 0.2s, background 0.2s, color 0.2s, transform 0.1s;
}
.mz-drop:hover {
  border-color: #FF6F00;
  background: #FFF7ED;
  color: #212529;
}
.mz-drop.mz-drag-over {
  border-color: #FF6F00;
  background: #FFF2E3;
  color: #E65100;
  transform: scale(1.005);
}
.mz-drop .mz-drop-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: linear-gradient(135deg, #FFE8D1 0%, #FFD8A8 100%);
  color: #E65100;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  margin-bottom: 2px;
}
.mz-drop strong { color: #212529; font-weight: 600; }
.mz-drop code {
  background: #E9ECEF;
  padding: 1px 6px;
  border-radius: 4px;
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, ui-monospace, monospace;
  font-size: 11.5px;
  color: #495057;
}

/* ── Divider ─────────────────────────────────────────────────────────── */
.mz-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #ADB5BD;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.mz-divider::before,
.mz-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #E9ECEF;
}

/* ── Status / messages ───────────────────────────────────────────────── */
.mz-footer {
  padding: 10px 24px 16px;
  border-top: 1px solid #F1F3F5;
  background: #FFFFFF;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mz-status { min-height: 18px; font-size: 13px; }
.mz-status-error { color: #DC2626; }
.mz-status-ok    { color: #16A34A; }
.mz-status-info  { color: #1E88E5; }

.mz-hint { font-size: 12px; color: #6C757D; display: flex; gap: 6px; align-items: center; }
.mz-hint code {
  background: #F1F3F5;
  padding: 1px 6px;
  border-radius: 4px;
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, ui-monospace, monospace;
  font-size: 11px;
}

/* ── Progress-loaded pill ────────────────────────────────────────────── */
.mz-ok-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #ECFDF5;
  border: 1px solid #A7F3D0;
  color: #065F46;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 500;
}
.mz-ok-pill::before {
  content: '✓';
  font-weight: 700;
  color: #16A34A;
}

/* ── Confirmation dialog (overwrite warning) ────────────────────────── */
.mz-confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(17, 24, 39, 0.55);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  animation: mz-overlay-in 0.16s ease-out;
}
.mz-confirm-overlay.mz-hidden { display: none; }

.mz-confirm-card {
  width: min(420px, 100%);
  background: #FFFFFF;
  border-radius: 16px;
  box-shadow:
    0 4px 24px rgba(0, 0, 0, 0.08),
    0 20px 60px rgba(0, 0, 0, 0.18);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  animation: mz-card-in 0.22s cubic-bezier(.2,.8,.2,1);
}

.mz-confirm-body {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 22px 22px 18px;
}

.mz-confirm-icon {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%);
  color: #B45309;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  line-height: 1;
  box-shadow: 0 4px 12px rgba(180, 83, 9, 0.18);
}

.mz-confirm-text { flex: 1; min-width: 0; }
.mz-confirm-text h3 {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 700;
  color: #212529;
  letter-spacing: -0.01em;
}
.mz-confirm-text p {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.5;
  color: #6C757D;
}

.mz-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px 18px;
  background: #F8F9FA;
  border-top: 1px solid #F1F3F5;
}

.mz-btn-danger {
  background: linear-gradient(135deg, #DC2626 0%, #EF4444 100%);
  color: #FFFFFF;
  border-color: #B91C1C;
  box-shadow: 0 4px 12px rgba(220, 38, 38, 0.24);
}
.mz-btn-danger:hover:not(:disabled) {
  background: linear-gradient(135deg, #B91C1C 0%, #DC2626 100%);
  box-shadow: 0 6px 16px rgba(220, 38, 38, 0.32);
}
.mz-btn-danger:focus-visible {
  outline: 3px solid rgba(220, 38, 38, 0.35);
  outline-offset: 2px;
}

/* ── Small screens ───────────────────────────────────────────────────── */
@media (max-width: 480px) {
  .mz-overlay { padding: 0; }
  .mz-card {
    max-height: 100vh;
    border-radius: 0;
    width: 100%;
    height: 100%;
  }
  .mz-body { padding: 16px; }
  .mz-header { padding: 16px; }
  .mz-tabs { padding: 8px 12px 0; }
}
`;
