/**
 * Memizy Plugin SDK v0.3.4 — Minimal Example
 *
 * A bare-bones plugin that relies entirely on the built-in Standalone UI:
 *   - No `mockData` is passed to `sdk.connect()`, so the modal opens
 *     automatically and blocks until the user loads an OQSE study set.
 *   - `standaloneControlsMode` and `standaloneUiPosition` are driven by
 *     URL parameters so you can test every combination by reloading.
 *
 * Accepted URL parameters:
 *   ?uiMode=auto|hidden           → standaloneControlsMode
 *   ?uiPos=bottom-right|bottom-left|top-right|top-left
 *                                  → standaloneUiPosition
 *   ?set=<url>                    → auto-load an OQSE file (handled by SDK)
 */

import {
  MemizySDK,
  isFlashcard,
  isMCQSingle,
  isMCQMulti,
  isTrueFalse,
  isShortAnswer,
  isMatchPairs,
  isSortItems,
  isNote,
  type OQSEItem,
  type StandaloneControlsMode,
} from '@memizy/plugin-sdk';

// ── URL params ──────────────────────────────────────────────────────────────

type UiPosition =
  | 'bottom-right'
  | 'bottom-left'
  | 'top-right'
  | 'top-left';

const params = new URLSearchParams(window.location.search);

const uiMode: StandaloneControlsMode =
  params.get('uiMode') === 'hidden' ? 'hidden' : 'auto';

const uiPos: UiPosition = (() => {
  const raw = params.get('uiPos');
  const valid: UiPosition[] = [
    'bottom-right',
    'bottom-left',
    'top-right',
    'top-left',
  ];
  return valid.includes(raw as UiPosition) ? (raw as UiPosition) : 'top-right';
})();

// ── DOM refs ────────────────────────────────────────────────────────────────

const target = document.getElementById('target') as HTMLDivElement;

const modeSelect = document.getElementById('ui-mode') as HTMLSelectElement;
const posSelect  = document.getElementById('ui-pos')  as HTMLSelectElement;
const urlInput   = document.getElementById('set-url') as HTMLInputElement;

const btnApply    = document.getElementById('btn-apply')     as HTMLButtonElement;
const btnOpenUI   = document.getElementById('btn-open-ui')   as HTMLButtonElement;
const btnClear    = document.getElementById('btn-clear')     as HTMLButtonElement;
const btnClearSet = document.getElementById('btn-clear-set') as HTMLButtonElement;

// Must match `STORAGE_KEY` in `src/standalone/MockHost.ts`.
const STANDALONE_STORAGE_KEY = 'memizy.plugin-sdk.standalone.v0.3';

// Reflect the active config in the form
modeSelect.value = uiMode;
posSelect.value  = uiPos;
urlInput.value   = params.get('set') ?? '';

// ── SDK instance ────────────────────────────────────────────────────────────

const sdk = new MemizySDK({
  id: 'com.memizy.playground.minimal.v3',
  version: '0.3.4',
  debug: true,
  standaloneControlsMode: uiMode,
  standaloneUiPosition:   uiPos,
});

sdk.onSetUpdated(() => {
  renderItems();
});

// ── Controls ────────────────────────────────────────────────────────────────

btnApply.addEventListener('click', () => {
  const next = new URLSearchParams();
  next.set('uiMode', modeSelect.value);
  next.set('uiPos',  posSelect.value);
  const setUrl = urlInput.value.trim();
  if (setUrl) next.set('set', setUrl);
  window.location.search = next.toString();
});

btnOpenUI.addEventListener('click', () => {
  sdk.openStandaloneUI();
});

btnClear.addEventListener('click', () => {
  window.location.search = '';
});

btnClearSet.addEventListener('click', () => {
  try {
    sessionStorage.removeItem(STANDALONE_STORAGE_KEY);
  } catch {
    // Ignore storage failures (quota / privacy mode).
  }
  window.location.reload();
});

// ── Boot ────────────────────────────────────────────────────────────────────

void boot();

async function boot(): Promise<void> {
  // No `mockData` here — this is the whole point of the minimal example.
  // The SDK will detect there's no study set and open the Standalone UI
  // modal automatically, blocking `connect()` until the user loads one.
  try {
    await sdk.connect();
  } catch (err) {
    renderError(err);
    return;
  }

  renderItems();
}

// ── Rendering ───────────────────────────────────────────────────────────────

function renderItems(): void {
  const items = sdk.store.getItems();

  if (items.length === 0) {
    target.innerHTML =
      '<div class="empty">Loaded an empty set — add items via the Standalone UI modal.</div>';
    return;
  }

  const preview = items.slice(0, 6);
  const extra   = items.length - preview.length;

  target.innerHTML =
    preview.map(renderRow).join('') +
    (extra > 0 ? `<div class="empty">…and ${extra} more item${extra === 1 ? '' : 's'}.</div>` : '');
}

function renderRow(item: OQSEItem): string {
  return `
    <div class="item-row">
      <strong>${escapeHtml(item.type)}</strong>
      ${escapeHtml(prompt(item))}
    </div>`;
}

function prompt(item: OQSEItem): string {
  if (isFlashcard(item))    return item.front;
  if (isMCQSingle(item))    return item.question;
  if (isMCQMulti(item))     return item.question;
  if (isTrueFalse(item))    return item.question;
  if (isShortAnswer(item))  return item.question;
  if (isMatchPairs(item))   return item.question ?? item.prompts.join(' · ');
  if (isSortItems(item))    return item.question;
  if (isNote(item))         return item.title ?? item.content.slice(0, 80);
  return item.id;
}

function renderError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  target.innerHTML = `
    <div class="empty" style="color:#B91C1C">
      connect() failed: ${escapeHtml(message)}
    </div>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
