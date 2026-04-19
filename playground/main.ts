/**
 * playground/main.ts  -  Memizy Plugin SDK v0.2.1 Playground Editor
 *
 * Full standalone editor / viewer showcasing ALL SDK capabilities:
 *  Study:    onInit, answer, skip, startItemTimer, exit, requestResize, reportError
 *  Edit:     saveItems, deleteItems, updateMeta, import/export .oqse.json
 *  Assets:   uploadAsset, getRawAsset  (IndexedDB in standalone)
 *  Progress: getProgress, syncProgress, export .oqsep
 *  Misc:     isStandalone, standaloneUiPosition, onConfigUpdate
 *  Text:     renderHtml (unsafe/sanitized), parseTextTokens (tokenized), XSS demo
 */

import { MemizyPlugin } from '../src/index';
import type { OQSEItem, InitSessionPayload, OQSEMeta, OQSETextToken } from '../src/index';

type SetMetaState = Partial<OQSEMeta>;
type StandaloneControlsMode = 'auto' | 'hidden';
type StandaloneUiPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

type FlashcardItem = Extract<OQSEItem, { type: 'flashcard' }>;
type McqSingleItem = Extract<OQSEItem, { type: 'mcq-single' }>;

function isFlashcard(item: OQSEItem): item is FlashcardItem {
  return item.type === 'flashcard';
}

function isMcqSingle(item: OQSEItem): item is McqSingleItem {
  return item.type === 'mcq-single';
}

function getPromptText(item: OQSEItem): string {
  if (isFlashcard(item)) return item.front;
  if (isMcqSingle(item)) return item.question;
  return item.type;
}

function getPlaygroundAssetKey(item: OQSEItem): string {
  const candidate = item.appSpecific?.['playgroundAssetKey'];
  return typeof candidate === 'string' ? candidate : '';
}

// -----------------------------------------------------------------------------
// Sample data (loaded on "Load Sample Set" click)
// -----------------------------------------------------------------------------

const SAMPLE_ITEMS: OQSEItem[] = [
  {
    id: 'item-001',
    type: 'flashcard',
    front: 'Complete this sentence: The powerhouse of the cell is <blank:powerhouse />. Visual: <asset:demo-image />',
    back: 'The mitochondrion.',
    appSpecific: { playgroundAssetKey: 'demo-image' },
  },
  { id: 'item-002', type: 'flashcard', front: 'Capital of Australia?', back: 'Canberra (not Sydney!).' },
  {
    id: 'item-003',
    type: 'mcq-single',
    question: 'Which planet is closest to the Sun?',
    options: ['Venus', 'Mercury', 'Earth', 'Mars'],
    correctIndex: 1,
  },
  {
    id: 'item-004',
    type: 'mcq-single',
    question: 'What does HTTP stand for?',
    options: [
      'HyperText Transfer Protocol',
      'Hyper Transfer Text Protocol',
      'High Transfer Tech Protocol',
      'HyperText Transport Protocol',
    ],
    correctIndex: 0,
  },
  { id: 'item-005', type: 'flashcard', front: 'Who wrote "The Republic"?', back: 'Plato.' },
];
const SAMPLE_META: SetMetaState = {
  title: 'Sample Study Set',
  description: 'Built-in demo set for the SDK Playground.',
  assets: {
    'demo-image': {
      type: 'image',
      value: 'https://upload.wikimedia.org/wikipedia/commons/3/3f/Cell_Organelles.png',
      altText: 'Cell organelles diagram',
    },
  },
};

const XSS_PAYLOAD = 'Unsafe HTML demo: <img src="x" onerror="alert(\'XSS fired from unsanitized renderHtml output\')" />';

function parseStandaloneControlsMode(value: string | null): StandaloneControlsMode {
  return value === 'hidden' ? 'hidden' : 'auto';
}

function parseStandaloneUiPosition(value: string | null): StandaloneUiPosition {
  if (value === 'bottom-left' || value === 'top-right' || value === 'top-left') return value;
  return 'bottom-right';
}

const startupParams = new URLSearchParams(window.location.search);
const configuredControlsMode = parseStandaloneControlsMode(startupParams.get('uiMode'));
const configuredUiPosition = parseStandaloneUiPosition(startupParams.get('uiCorner'));

// -----------------------------------------------------------------------------
// SDK instance
// -----------------------------------------------------------------------------

const plugin = new MemizyPlugin({
  id: 'https://playground.memizy.local/editor',
  version: '0.2.1',
  standaloneTimeout: 1500,
  debug: true,
  standaloneControlsMode: configuredControlsMode,
  standaloneUiPosition: configuredUiPosition,
});

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

let items: OQSEItem[] = [];
let setMeta: SetMetaState = {};
let cursor                = 0;
let answered              = 0;
const answeredItemIds = new Set<string>();
/** blobURL cache: key -> blob: URL */
const assetCache: Record<string, string> = {};

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------

function esc(s: string): string { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function uid(): string { return 'item-' + Date.now().toString(36) + Math.random().toString(36).slice(2,5); }
function fmtDate(iso?: string): string { if (!iso) return ' - '; const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleDateString(); }

// Console panel
const consoleEl = document.getElementById('console-panel')!;
function log(msg: string, type: 'ok'|'err'|'inf'|'warn' = 'inf'): void {
  const ts = new Date().toLocaleTimeString();
  consoleEl.innerHTML += `<span class="log-ts">${ts}</span><span class="log-${type}">${esc(msg)}</span><br/>`;
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

// Get element (throw-safe)
function $<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }

// Download helper
function download(data: string, filename: string, mime = 'application/json'): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: mime }));
  a.download = filename;
  a.click();
}

function basicSanitizer(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;

  template.content.querySelectorAll('script, iframe, object, embed').forEach(el => el.remove());
  template.content.querySelectorAll<HTMLElement>('*').forEach(el => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      if ((name === 'src' || name === 'href') && value.startsWith('javascript:')) {
        el.removeAttribute(attr.name);
      }
    }
  });

  return template.innerHTML;
}

function mapTokensToHtml(tokens: OQSETextToken[]): string {
  return tokens.map((token) => {
    if (token.type === 'text') return esc(token.value);
    if (token.type === 'blank') {
      return `<input type="text" placeholder="${esc(token.key)}" class="oqse-blank" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;" />`;
    }
    if (token.type === 'asset' && token.media) {
      const media = token.media;
      const url = esc(media.value);
      if (media.type === 'image') {
        return `<img src="${url}" alt="${esc(media.altText ?? token.key)}" style="max-width:180px;border-radius:8px;display:inline-block;" />`;
      }
      if (media.type === 'audio') {
        return `<audio controls src="${url}"></audio>`;
      }
      if (media.type === 'video') {
        return `<video controls src="${url}" style="max-width:220px;"></video>`;
      }
      return `<span class="text-muted">[unsupported asset:${esc(token.key)}]</span>`;
    }
    return `<span class="text-muted">[missing asset:${esc(token.key)}]</span>`;
  }).join('');
}

function getRawDemoInput(): string {
  return $<HTMLTextAreaElement>('tp-input').value;
}

function renderHtmlOutput(rawText: string, useSanitizer: boolean): void {
  const html = plugin.renderHtml(rawText, {
    sanitizer: useSanitizer ? basicSanitizer : undefined,
  });
  $('tp-low-output').innerHTML = html;
}

function renderTokenizedOutput(rawText: string): void {
  const tokens = plugin.parseTextTokens(rawText);
  $('tp-token-json').textContent = JSON.stringify(tokens, null, 2);
  $('tp-high-output').innerHTML = mapTokensToHtml(tokens);
}

function setTextDemoFromCurrentItem(item: OQSEItem): void {
  const rawText = getPromptText(item);
  $<HTMLTextAreaElement>('tp-input').value = rawText;
  renderHtmlOutput(rawText, true);
  renderTokenizedOutput(rawText);
}

// -----------------------------------------------------------------------------
// Welcome screen
// -----------------------------------------------------------------------------

$('btn-load-samples').addEventListener('click', async () => {
  log('Loading sample set via saveItems() + updateMeta()...', 'inf');
  await plugin.saveItems(SAMPLE_ITEMS);
  await plugin.updateMeta(SAMPLE_META);
  log('Sample set saved  -  reloading to trigger onInit...', 'ok');
  setTimeout(() => location.reload(), 350);
});

$('btn-new-empty').addEventListener('click', async () => {
  await plugin.updateMeta({ title: 'New Study Set', description: '' });
  log('Empty set created  -  reloading...', 'ok');
  setTimeout(() => location.reload(), 350);
});

// -----------------------------------------------------------------------------
// Tab switching
// -----------------------------------------------------------------------------

function showTab(name: string): void {
  document.querySelectorAll<HTMLElement>('.tab-content').forEach(p => p.classList.remove('active'));
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach(b => b.classList.remove('active'));
  const panel = $(`tab-${name}`);
  panel.classList.remove('hidden');
  panel.classList.add('active');
  (document.querySelector(`.tab[data-tab="${name}"]`) as HTMLButtonElement)?.classList.add('active');
  if (name === 'progress') renderProgressTable();
  if (name === 'edit')     renderItemList();
  if (name === 'assets')   renderAssetGrid();
}

function applyStandaloneUiSettings(): void {
  const modeSelect = $<HTMLSelectElement>('input-gear-mode');
  const cornerSelect = $<HTMLSelectElement>('input-gear-corner');
  const mode = parseStandaloneControlsMode(modeSelect.value);
  const corner = parseStandaloneUiPosition(cornerSelect.value);
  const params = new URLSearchParams(window.location.search);
  params.set('uiMode', mode);
  params.set('uiCorner', corner);
  const query = params.toString();
  window.location.search = query.length > 0 ? `?${query}` : '';
}

function initStandaloneUiControls(): void {
  const modeSelect = $<HTMLSelectElement>('input-gear-mode');
  const cornerSelect = $<HTMLSelectElement>('input-gear-corner');
  const applyBtn = $<HTMLButtonElement>('btn-apply-gear-settings');

  modeSelect.value = configuredControlsMode;
  cornerSelect.value = configuredUiPosition;
  cornerSelect.disabled = configuredControlsMode === 'hidden';

  modeSelect.addEventListener('change', () => {
    cornerSelect.disabled = modeSelect.value === 'hidden';
  });
  applyBtn.addEventListener('click', applyStandaloneUiSettings);
}

document.querySelectorAll<HTMLButtonElement>('.tab').forEach(btn => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab!));
});

initStandaloneUiControls();

function revealUI(): void {
  $('welcome-screen').classList.add('hidden');
  $('tab-bar').classList.remove('hidden');
  // Un-hide all tab panels so showTab() can display them
  document.querySelectorAll<HTMLElement>('.tab-content').forEach(p => p.classList.remove('hidden'));
  showTab('study');
}

function getBucketCounts(): number[] {
  const prog = plugin.getProgress();
  const counts = [0, 0, 0, 0, 0];
  items.forEach((item) => {
    const raw = prog[item.id]?.bucket ?? 0;
    const bucket = Math.max(0, Math.min(4, raw));
    counts[bucket] += 1;
  });
  return counts;
}

function updateBucketDistributionUI(): void {
  const counts = getBucketCounts();
  const total = items.length || 1;
  counts.forEach((count, idx) => {
    const widthPct = (count / total) * 100;
    $<HTMLElement>(`bucket-seg-${idx}`).style.width = `${widthPct}%`;
    $<HTMLElement>(`bucket-count-${idx}`).textContent = String(count);
  });
}

// -----------------------------------------------------------------------------
// Study tab
// -----------------------------------------------------------------------------

const cardArea        = $('card-area');

function updateBucketBar(item: OQSEItem): void {
  const prog   = plugin.getProgress();
  const rec    = prog[item.id];
  const bucket = rec?.bucket ?? 0;
  for (let i = 0; i <= 4; i++) {
    const dot = $(`bdot${i}`);
    dot.classList.toggle('cur', i === bucket);
  }
  $('blabel').textContent = `Item bucket: ${bucket}`;
  $('session-stats').textContent = `${answered} answered`;
  updateBucketDistributionUI();
}

function renderFlashcard(item: FlashcardItem): void {
  cardArea.innerHTML = `
    <span class="item-badge flashcard">Flashcard</span>
    <span class="item-pos">${cursor + 1} / ${items.length}</span>
    <div class="item-question">${esc(item.front)}</div>
    <div class="item-answer" id="fc-answer">${esc(item.back)}</div>
  `;

  const assetKey = getPlaygroundAssetKey(item);
  if (assetKey && assetCache[assetKey]) {
    const img = document.createElement('img');
    img.id = 'item-asset-img';
    img.src = assetCache[assetKey];
    img.style.display = 'block';
    cardArea.appendChild(img);
  }
  $<HTMLButtonElement>('btn-reveal').disabled  = false;
  $<HTMLButtonElement>('btn-correct').disabled = true;
  $<HTMLButtonElement>('btn-wrong').disabled   = true;
  $<HTMLButtonElement>('btn-skip').disabled    = false;
  $<HTMLButtonElement>('btn-next').disabled    = true;
}

function renderMCQ(item: McqSingleItem): void {
  const opts    = item.options;
  const correct = item.correctIndex;
  const letters = ['A','B','C','D'];
  let optsHtml  = '';
  opts.forEach((o, i) => {
    optsHtml += `<button class="option-btn" data-idx="${i}"><span class="opt-ltr">${letters[i]}</span>${esc(o)}</button>`;
  });

  cardArea.innerHTML = `
    <span class="item-badge mcq-single">MCQ</span>
    <span class="item-pos">${cursor + 1} / ${items.length}</span>
    <div class="item-question">${esc(item.question)}</div>
    <div class="mcq-options">${optsHtml}</div>
  `;

  cardArea.querySelectorAll<HTMLButtonElement>('.option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx       = Number(btn.dataset.idx);
      const isCorrect = idx === correct;
      btn.classList.add(isCorrect ? 'opt-correct' : 'opt-wrong');
      if (!isCorrect) {
        cardArea.querySelectorAll<HTMLButtonElement>('.option-btn')[correct]?.classList.add('opt-correct');
      }
      cardArea.querySelectorAll<HTMLButtonElement>('.option-btn').forEach(b => b.disabled = true);
      plugin.answer(item.id, isCorrect, { confidence: isCorrect ? 4 : 1 });
      answeredItemIds.add(item.id);
      answered++;
      updateBucketBar(item);
      log(`MCQ answer(${item.id}, ${isCorrect})`, isCorrect ? 'ok' : 'err');
      setTimeout(() => moveNext(), 850);
    });
  });

  $<HTMLButtonElement>('btn-reveal').disabled  = true;
  $<HTMLButtonElement>('btn-correct').disabled = true;
  $<HTMLButtonElement>('btn-wrong').disabled   = true;
  $<HTMLButtonElement>('btn-skip').disabled    = false;
  $<HTMLButtonElement>('btn-next').disabled    = true;
}

function renderItem(item: OQSEItem): void {
  plugin.startItemTimer(item.id);
  if (isFlashcard(item)) renderFlashcard(item);
  else if (isMcqSingle(item)) renderMCQ(item);
  else {
    cardArea.innerHTML = `<div class="item-question">${esc(item.type)}: ${esc(getPromptText(item))}</div>`;
  }
  setTextDemoFromCurrentItem(item);
  updateBucketBar(item);
}

function moveNext(): void {
  if (items.length === 0) {
    enableSession(false);
    return;
  }

  const progress = plugin.getProgress();
  if (answeredItemIds.size >= items.length && answered >= items.length) {
    cardArea.innerHTML = `
      <div class="waiting">:tada:</div>
      <div class="waiting-label">Great work: all ${items.length} items were answered at least once.</div>
    `;
    enableSession(false);
    $<HTMLButtonElement>('btn-restart').disabled = false;
    log('Adaptive session complete. All items were answered at least once.', 'ok');
    return;
  }

  const ranked = items
    .map((item, index) => ({ index, bucket: progress[item.id]?.bucket ?? 0 }))
    .sort((a, b) => a.bucket - b.bucket);

  const next = ranked.find(entry => entry.index !== cursor) ?? ranked[0];
  cursor = next?.index ?? 0;
  renderItem(items[cursor]!);
}

function enableSession(on: boolean): void {
  (['btn-reveal','btn-correct','btn-wrong','btn-skip','btn-next','btn-exit'] as const).forEach(id => {
    $<HTMLButtonElement>(id).disabled = !on;
  });
  if (on) $<HTMLButtonElement>('btn-restart').disabled = true;
}

// Reveal (flashcard)
$('btn-reveal').addEventListener('click', () => {
  const ansEl = document.getElementById('fc-answer');
  if (ansEl) ansEl.style.display = 'block';
  $<HTMLButtonElement>('btn-reveal').disabled  = true;
  $<HTMLButtonElement>('btn-correct').disabled = false;
  $<HTMLButtonElement>('btn-wrong').disabled   = false;
  $<HTMLButtonElement>('btn-next').disabled    = false;
});

$('btn-correct').addEventListener('click', () => {
  const item = items[cursor]; if (!item) return;
  plugin.answer(item.id, true, { confidence: 4 });
  answeredItemIds.add(item.id);
  answered++;
  updateBucketBar(item);
  log(`answer(${item.id}, correct)`, 'ok');
  moveNext();
});

$('btn-wrong').addEventListener('click', () => {
  const item = items[cursor]; if (!item) return;
  plugin.answer(item.id, false, { confidence: 1 });
  answeredItemIds.add(item.id);
  answered++;
  updateBucketBar(item);
  log(`answer(${item.id}, wrong)`, 'err');
  moveNext();
});

$('btn-skip').addEventListener('click', () => {
  const item = items[cursor]; if (!item) return;
  plugin.skip(item.id);
  log(`skip(${item.id})`, 'warn');
  moveNext();
});

$('btn-next').addEventListener('click', () => moveNext());

$('btn-restart').addEventListener('click', () => {
  cursor  = 0;
  answered = 0;
  answeredItemIds.clear();
  $<HTMLButtonElement>('btn-restart').disabled = true;
  enableSession(true);
  if (items[0]) renderItem(items[0]);
  log('Adaptive session restarted.', 'inf');
});

$('btn-exit').addEventListener('click', () => {
  plugin.exit({ score: Math.round((answered / Math.max(items.length, 1)) * 100) });
  enableSession(false);
  log('exit() called.', 'ok');
});

$('btn-resize-test').addEventListener('click', () => {
  plugin.requestResize(640);
  log('Request Resize sent (height=640).', 'inf');
});

$('btn-report-err').addEventListener('click', () => {
  plugin.reportError('PLAYGROUND_TEST', 'Test error from the playground editor.');
  log('Report Error sent (PLAYGROUND_TEST).', 'warn');
});

$('btn-render-low').addEventListener('click', () => {
  const raw = getRawDemoInput();
  renderHtmlOutput(raw, false);
  log('Unsafe renderHtml() output rendered without sanitizer.', 'warn');
});

$('btn-render-low-safe').addEventListener('click', () => {
  const raw = getRawDemoInput();
  renderHtmlOutput(raw, true);
  log('Sanitized renderHtml() output rendered with custom sanitizer.', 'ok');
});

$('btn-render-high').addEventListener('click', () => {
  const raw = getRawDemoInput();
  renderTokenizedOutput(raw);
  log('Tokenized parseTextTokens() output rendered via manual mapping.', 'ok');
});

$('btn-xss-alert').addEventListener('click', () => {
  $<HTMLTextAreaElement>('tp-input').value = XSS_PAYLOAD;
  renderHtmlOutput(XSS_PAYLOAD, false);
  renderTokenizedOutput(XSS_PAYLOAD);
  log('XSS demo executed: unsafe HTML output may trigger alert().', 'warn');
});

// -----------------------------------------------------------------------------
// Edit tab
// -----------------------------------------------------------------------------

function renderItemList(): void {
  const list   = $('item-list');
  const prog   = plugin.getProgress();
  $('items-count').textContent = String(items.length);
  $('edit-item-count').textContent = `${items.length} item${items.length !== 1 ? 's' : ''}`;

  if (items.length === 0) {
    list.innerHTML = '<div class="text-muted" style="text-align:center;padding:20px;">No items yet. Add one below.</div>';
    return;
  }

  list.innerHTML = items.map(item => {
    const bucket = prog[item.id]?.bucket ?? 0;
    const q = esc(getPromptText(item)).slice(0, 80);
    return `
      <div class="item-row">
        <span class="irt ${item.type}">${esc(item.type)}</span>
        <span class="irq" title="${esc(getPromptText(item))}">${q}</span>
        <span class="bpill bp${bucket}">B${bucket}</span>
        <button class="btn btn-ghost btn-sm" data-del="${esc(item.id)}">&times;</button>
      </div>`;
  }).join('');

  list.querySelectorAll<HTMLButtonElement>('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.del!;
      plugin.deleteItems([id]);
      items = items.filter(i => i.id !== id);
      log(`deleteItems(["${id}"])`, 'warn');
      renderItemList();
    });
  });
}

// Setup meta fields from current setMeta
function populateMetaFields(): void {
  $<HTMLInputElement>('input-set-title').value = setMeta.title ?? '';
  $<HTMLInputElement>('input-set-desc' ).value = setMeta.description ?? '';
}

$('btn-save-meta').addEventListener('click', () => {
  const title = ($<HTMLInputElement>('input-set-title')).value.trim();
  const desc  = ($<HTMLInputElement>('input-set-desc' )).value.trim();
  plugin.updateMeta({ title, description: desc });
  setMeta.title       = title;
  setMeta.description = desc;
  $('header-set-title').textContent = title || 'Untitled';
  log(`updateMeta({ title: "${title}", description: "${desc}" })`, 'ok');
});

// Item type switcher
$('select-item-type').addEventListener('change', (e) => {
  const val = (e.target as HTMLSelectElement).value;
  if (val === 'mcq-single') {
    $('fc-fields').classList.add('hidden');
    $('mcq-fields').classList.remove('hidden');
  } else {
    $('fc-fields').classList.remove('hidden');
    $('mcq-fields').classList.add('hidden');
  }
});

$('btn-add-item').addEventListener('click', () => {
  const type     = ($<HTMLSelectElement>('select-item-type')).value;
  const question = ($<HTMLInputElement> ('input-item-question')).value.trim();
  const assetKey = ($<HTMLInputElement> ('input-item-asset')).value.trim();
  if (!question) { log('Question is empty!', 'err'); return; }

  let newItem: OQSEItem;
  if (type === 'flashcard') {
    const answer = ($<HTMLTextAreaElement>('input-fc-answer')).value.trim();
    if (!answer) { log('Answer is empty!', 'err'); return; }
    newItem = {
      id: uid(),
      type: 'flashcard',
      front: question,
      back: answer,
      ...(assetKey ? { appSpecific: { playgroundAssetKey: assetKey } } : {}),
    };
  } else {
    const opts = Array.from(document.querySelectorAll<HTMLInputElement>('.mopt')).map(i => i.value.trim()).filter(Boolean);
    if (opts.length < 2) { log('At least 2 MCQ options required!', 'err'); return; }
    const correctInput = document.querySelector<HTMLInputElement>('input[name="copt"]:checked')
      ?? document.querySelector<HTMLInputElement>('input[name="mcq-correct"]:checked');
    const correct = Number(correctInput?.value ?? 0);
    newItem = {
      id: uid(),
      type: 'mcq-single',
      question,
      options: opts,
      correctIndex: correct,
      ...(assetKey ? { appSpecific: { playgroundAssetKey: assetKey } } : {}),
    };
  }

  plugin.saveItems([newItem]);
  items.push(newItem);
  log(`saveItems([{ id: "${newItem.id}", type: "${type}", ... }])`, 'ok');
  renderItemList();
  btnClearForm();
});

function btnClearForm(): void {
  ($<HTMLInputElement> ('input-item-question')).value = '';
  ($<HTMLInputElement> ('input-item-asset')).value    = '';
  ($<HTMLTextAreaElement>('input-fc-answer')).value   = '';
  document.querySelectorAll<HTMLInputElement>('.mopt').forEach(i => i.value = '');
}
$('btn-clear-form').addEventListener('click', btnClearForm);

// Export .oqse.json
$('btn-export-json').addEventListener('click', () => {
  const payload = { meta: setMeta, items };
  download(JSON.stringify(payload, null, 2), 'export.oqse.json');
  log(`Exported ${items.length} items as export.oqse.json.`, 'ok');
});

// Import .oqse.json
$<HTMLInputElement>('input-import-json').addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result)) as { meta?: SetMetaState; items?: OQSEItem[] };
      const importedItems = data.items ?? [];
      const importedMeta  = data.meta  ?? {};
      plugin.saveItems(importedItems);
      plugin.updateMeta(importedMeta);
      log(`Imported ${importedItems.length} items from ${file.name}. Reloading...`, 'ok');
      setTimeout(() => location.reload(), 400);
    } catch(err) {
      log(`Import failed: ${String(err)}`, 'err');
    }
  };
  reader.readAsText(file);
});

// -----------------------------------------------------------------------------
// Assets tab
// -----------------------------------------------------------------------------

function renderAssetGrid(): void {
  const grid = $('asset-grid');
  const empty = $('assets-empty');
  const keys  = Object.keys(assetCache);
  if (keys.length === 0) {
    empty.style.display = 'block';
    grid.classList.add('hidden');
    return;
  }
  empty.style.display = 'none';
  grid.classList.remove('hidden');
  grid.innerHTML = keys.map(key => {
    const url = assetCache[key];
    const isImage = /\.(png|jpe?g|gif|webp|svg)$/i.test(key);
    const thumb   = isImage ? `<img src="${url}" alt="${esc(key)}" />` : `<span style="font-size:2rem">&#128196;</span>`;
    return `
      <div class="asset-card">
        <div class="athumb">${thumb}</div>
        <div class="ainfo">
          <div class="akey" title="${esc(key)}">${esc(key)}</div>
          <div class="aact">
            <button class="btn btn-ghost btn-sm" data-copy="${esc(key)}">&#128203; Key</button>
            <button class="btn btn-ghost btn-sm" data-raw="${esc(key)}">&#128269; Raw</button>
          </div>
        </div>
      </div>`;
  }).join('');

  const emptyEl = document.getElementById('assets-empty');
  if (emptyEl) grid.insertAdjacentElement('afterbegin', emptyEl);

  grid.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.copy!).catch(() => {});
      log(`Key "${btn.dataset.copy}" copied to clipboard.`, 'ok');
    });
  });

  grid.querySelectorAll<HTMLButtonElement>('[data-raw]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.raw!;
      try {
        const raw = await plugin.getRawAsset(key);
        log(`getRawAsset("${key}") -> ${raw ? `File/Blob size=${(raw as Blob).size}B type=${(raw as Blob).type}` : 'null'}`, 'ok');
      } catch(err) {
        log(`getRawAsset("${key}") failed: ${String(err)}`, 'err');
      }
    });
  });
}

$('btn-upload-asset').addEventListener('click', async () => {
  const keyInput  = $<HTMLInputElement>('input-asset-key');
  const fileInput = $<HTMLInputElement>('input-asset-file');
  const key   = keyInput.value.trim();
  const file  = fileInput.files?.[0];
  if (!key)  { log('Asset key is empty!', 'err'); return; }
  if (!file) { log('No file selected!', 'err'); return; }

  log(`uploadAsset("${key}", ${file.name})...`, 'inf');
  try {
    const media = await plugin.uploadAsset(file, key);
    assetCache[key] = media.value; // blob: URL in standalone
    log(`uploadAsset resolved: type=${media.type} url=${media.value.slice(0,40)}...`, 'ok');
    keyInput.value  = '';
    fileInput.value = '';
    renderAssetGrid();
  } catch(err) {
    log(`uploadAsset failed: ${String(err)}`, 'err');
  }
});

// -----------------------------------------------------------------------------
// Progress tab
// -----------------------------------------------------------------------------

function renderProgressTable(): void {
  const tbody  = $('progress-tbody');
  const prog   = plugin.getProgress();
  const keys   = Object.keys(prog);
  if (keys.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#64748b;padding:20px;">No progress yet  -  study some items first.</td></tr>';
    return;
  }
  tbody.innerHTML = keys.map(id => {
    const r   = prog[id]!;
    const itm = items.find(i => i.id === id);
    const q   = esc(itm ? getPromptText(itm) : id).slice(0, 50);
    return `
      <tr>
        <td><code>${esc(id)}</code></td>
        <td>${q}</td>
        <td><span class="bb bb${r.bucket}">${r.bucket}</span></td>
        <td>${r.stats.attempts}</td>
        <td>${r.stats.streak}</td>
        <td>${esc(r.lastAnswer?.answeredAt ? fmtDate(r.lastAnswer.answeredAt) : ' - ')}</td>
        <td>${r.nextReviewAt ? fmtDate(r.nextReviewAt) : ' - '}</td>
      </tr>`;
  }).join('');
}

$('btn-refresh-progress').addEventListener('click', () => {
  renderProgressTable();
  log(`getProgress(): ${Object.keys(plugin.getProgress()).length} records refreshed.`, 'ok');
});

$('btn-export-oqsep').addEventListener('click', () => {
  const prog = plugin.getProgress();
  const data = JSON.stringify({ version: '1.0', meta: setMeta, records: prog }, null, 2);
  download(data, 'export.oqsep');
  log(`Exported .oqsep with ${Object.keys(prog).length} records.`, 'ok');
});

$('btn-sync-all').addEventListener('click', () => {
  const prog = plugin.getProgress();
  plugin.syncProgress(prog);
  log(`syncProgress(${Object.keys(prog).length} records) -> SYNC_PROGRESS sent.`, 'ok');
});

// -----------------------------------------------------------------------------
// onInit  -  fires once the IDB set is loaded (standalone) or host sends INIT_SESSION
// -----------------------------------------------------------------------------

plugin
  .onInit((payload: InitSessionPayload) => {
    items    = [...payload.items];
    setMeta  = { ...setMeta };
    cursor   = 0;
    answered = 0;
    answeredItemIds.clear();

    // Resolve set-level assets into cache
    Object.entries(payload.assets ?? {}).forEach(([k, mo]) => {
      if (mo?.value) assetCache[k] = mo.value;
    });
    // Resolve per-item assets
    items.forEach(item => {
      const ia = item.assets;
      Object.entries(ia ?? {}).forEach(([k, mo]) => {
        if (mo?.value) assetCache[k] = mo.value;
      });
    });

    // Update header
    const title = payload.assets?.['__meta__']?.altText
      ?? setMeta.title
      ?? 'Untitled Set';
    $('header-set-title').textContent = title;
    setMeta.title = title;

    log(`onInit: ${items.length} items  |  isStandalone=${plugin.isStandalone()}  |  locale=${payload.settings?.locale ?? 'n/a'}`, 'ok');
    log('Adaptive mode enabled (completion after each item gets at least one answer).', 'inf');

    if (items.length === 0) {
      revealUI();
      updateBucketDistributionUI();
      cardArea.innerHTML = `<div class="waiting">&#128221;</div><div class="waiting-label">Set is empty - use the Edit tab to add items.</div>`;
      enableSession(false);
      $<HTMLButtonElement>('btn-restart').disabled = true;
      populateMetaFields();
      return;
    }

    revealUI();
    updateBucketDistributionUI();
    populateMetaFields();
    enableSession(true);
    renderItem(items[0]!);
  })
  .onConfigUpdate((cfg) => {
    log(`onConfigUpdate: ${JSON.stringify(cfg)}`, 'inf');
  });

// -----------------------------------------------------------------------------
// Boot log
// -----------------------------------------------------------------------------

log(`isStandalone()=${plugin.isStandalone()}  -  waiting for onInit...`, 'inf');
