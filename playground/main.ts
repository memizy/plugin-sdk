/**
 * playground/main.ts — Memizy Plugin SDK development playground.
 *
 * Tests all major SDK capabilities using mock data:
 *  • onInit / onConfigUpdate
 *  • answer, skip, syncProgress, getProgress
 *  • saveItems, deleteItems, updateMeta
 *  • uploadAsset, getRawAsset
 *  • startItemTimer / stopItemTimer
 *  • exit, requestResize, reportError, isStandalone
 */

import { MemizyPlugin } from '../src/index';
import type { OQSEItem, InitSessionPayload, ProgressRecord } from '../src/index';

// ── Mock study-set data ───────────────────────────────────────────────────

const MOCK_ITEMS: OQSEItem[] = [
  {
    id: 'item-001',
    type: 'flashcard',
    question: 'What is the powerhouse of the cell?',
    answer: 'The mitochondrion.',
  },
  {
    id: 'item-002',
    type: 'flashcard',
    question: 'What does HTTP stand for?',
    answer: 'HyperText Transfer Protocol.',
  },
  {
    id: 'item-003',
    type: 'flashcard',
    question: 'What year was the World Wide Web invented?',
    answer: '1989 (by Tim Berners-Lee at CERN).',
  },
];

// ── SDK instantiation ─────────────────────────────────────────────────────

const plugin = new MemizyPlugin({
  id: 'https://playground.memizy.local/test-plugin',
  version: '0.2.0',
  standaloneTimeout: 1500,
  debug: true,
  showStandaloneControls: true,
});

plugin.useMockData(MOCK_ITEMS, {
  assets: {},
  settings: { shuffle: false, maxItems: null },
});

// ── Playground state ──────────────────────────────────────────────────────

let items: OQSEItem[] = [];
let cursor = 0;

// ── DOM helpers ───────────────────────────────────────────────────────────

const cardArea     = document.getElementById('card-area')!;
const progressPanel = document.getElementById('progress-panel') as HTMLElement;
const progressJson  = document.getElementById('progress-json') as HTMLPreElement;
const consoleEl    = document.getElementById('console')!;

const btnReveal   = document.getElementById('btn-reveal')   as HTMLButtonElement;
const btnCorrect  = document.getElementById('btn-correct')  as HTMLButtonElement;
const btnWrong    = document.getElementById('btn-wrong')    as HTMLButtonElement;
const btnSkip     = document.getElementById('btn-skip')     as HTMLButtonElement;
const btnNext     = document.getElementById('btn-next')     as HTMLButtonElement;
const btnMock     = document.getElementById('btn-mock')     as HTMLButtonElement;
const btnAsset    = document.getElementById('btn-asset')    as HTMLButtonElement;
const btnProgress = document.getElementById('btn-progress') as HTMLButtonElement;
const btnExit     = document.getElementById('btn-exit')     as HTMLButtonElement;

function log(msg: string, type: 'ok' | 'err' | 'inf' = 'inf'): void {
  const ts = new Date().toLocaleTimeString();
  consoleEl.innerHTML +=
    `<span class="log-ts">${ts}</span><span class="log-${type}">${escHtml(msg)}</span><br/>`;
  consoleEl.scrollTop = consoleEl.scrollHeight;
}
function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function enableSessionControls(on: boolean): void {
  btnReveal.disabled  = !on;
  btnCorrect.disabled = !on;
  btnWrong.disabled   = !on;
  btnSkip.disabled    = !on;
  btnNext.disabled    = !on;
  btnExit.disabled    = !on;
}

function renderItem(item: OQSEItem): void {
  const answerEl = cardArea.querySelector('#item-answer') as HTMLElement | null;
  if (answerEl) answerEl.style.display = 'none';

  cardArea.innerHTML = `
    <div id="item-type">${String(item.type).toUpperCase()}</div>
    <div id="item-question">${escHtml(String(item.question ?? 'No question'))}</div>
    <div id="item-answer">${escHtml(String(item.answer ?? '(no answer)'))}</div>
    <div id="item-id">ID: ${item.id}</div>
  `;

  btnReveal.onclick = () => {
    const ans = cardArea.querySelector('#item-answer') as HTMLElement | null;
    if (ans) ans.style.display = 'block';
    btnReveal.disabled = true;
  };

  plugin.startItemTimer(item.id);
  log(`Showing item ${cursor + 1}/${items.length}: "${String(item.question).slice(0, 40)}…"`, 'inf');
}

function nextItem(): void {
  cursor++;
  if (cursor >= items.length) {
    cardArea.innerHTML = `
      <div class="waiting">🎉</div>
      <div class="subtitle">All ${items.length} items reviewed!</div>
    `;
    enableSessionControls(false);
    log('All items reviewed — session complete!', 'ok');
    return;
  }
  renderItem(items[cursor]!);
}

// ── Initialise ───────────────────────────────────────────────────────────

plugin
  .onInit((payload: InitSessionPayload) => {
    items  = [...payload.items];
    cursor = 0;
    enableSessionControls(true);
    log(`onInit: ${items.length} items, sessionId=${payload.sessionId}`, 'ok');
    if (items.length > 0) renderItem(items[cursor]!);
  })
  .onConfigUpdate((cfg) => {
    log(`onConfigUpdate: ${JSON.stringify(cfg)}`, 'inf');
  });

// ── Button wiring ────────────────────────────────────────────────────────

btnCorrect.addEventListener('click', () => {
  const item = items[cursor];
  if (!item) return;
  plugin.answer(item.id, true, { confidence: 4 });
  log(`answer(${item.id}, true, confidence=4)`, 'ok');
  nextItem();
});

btnWrong.addEventListener('click', () => {
  const item = items[cursor];
  if (!item) return;
  plugin.answer(item.id, false, { confidence: 1 });
  log(`answer(${item.id}, false, confidence=1)`, 'err');
  nextItem();
});

btnSkip.addEventListener('click', () => {
  const item = items[cursor];
  if (!item) return;
  plugin.skip(item.id);
  log(`skip(${item.id})`, 'inf');
  nextItem();
});

btnNext.addEventListener('click', () => {
  const item = items[cursor];
  if (item) plugin.clearItemTimer(item.id);
  nextItem();
});

btnMock.addEventListener('click', () => {
  plugin.triggerMock();
  log('triggerMock() fired', 'inf');
});

btnProgress.addEventListener('click', () => {
  const snap = plugin.getProgress();
  progressJson.textContent = JSON.stringify(snap, null, 2);
  progressPanel.style.display = 'block';
  log(`getProgress(): ${Object.keys(snap).length} records`, 'ok');
});

btnExit.addEventListener('click', () => {
  plugin.exit({ score: 99 });
  log('exit({ score: 99 }) sent', 'ok');
  enableSessionControls(false);
});

btnAsset.addEventListener('click', async () => {
  // Create a tiny 1×1 white PNG blob as a test asset
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==';
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: 'image/png' });
  log('uploadAsset() called with 1×1 test PNG…', 'inf');
  try {
    const media = await plugin.uploadAsset(blob, 'test-1x1.png');
    log(`uploadAsset resolved: ${JSON.stringify(media)}`, 'ok');
  } catch (err) {
    // In standalone / no-host mode this will reject — expected behaviour
    log(`uploadAsset rejected (expected outside host): ${String(err)}`, 'err');
  }
});

// ── Misc API smoke tests ─────────────────────────────────────────────────

plugin.requestResize(600);
plugin.reportError('PLAYGROUND_BOOT', 'Playground started successfully — this is a test error report.');
log(`isStandalone(): ${plugin.isStandalone()}`, 'inf');

// CRUD smoke (host not present — postMessage goes nowhere, that is fine for dev)
plugin.saveItems([{ id: 'item-999', type: 'flashcard', question: 'New item.' }]);
plugin.deleteItems(['item-999']);
plugin.updateMeta({ title: 'Test Study Set (Playground)' });
log('CRUD smoke: saveItems, deleteItems, updateMeta sent (no-op without host)', 'inf');
