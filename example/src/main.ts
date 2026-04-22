/**
 * Memizy Plugin SDK v0.3.0 — Playground
 *
 * Comprehensive demo covering every public API surface:
 *   sdk.connect()          – connect with remote OQSE test-suite as mockData
 *   sdk.store              – answer, skip, startItemTimer, createItem, updateItem,
 *                            deleteItem, updateMeta, getProgress, getItems, getMeta
 *   sdk.assets             – upload, all()
 *   sdk.text               – renderHtml (unsafe & DOMPurify-safe), parseTokens
 *   sdk.sys                – exit, requestResize, reportError
 *   sdk.openStandaloneUI() – load-another-set trigger
 *
 * External data: https://cdn.jsdelivr.net/gh/memizy/set-test-suite@main/data.oqse.json
 */

import DOMPurify from 'dompurify';

import {
  MemizySDK,
  generateUUID,
  isFlashcard,
  isMCQSingle,
  isMCQMulti,
  isTrueFalse,
  isShortAnswer,
  isMatchPairs,
  isSortItems,
  isNote,
  type OQSEItem,
  type OQSEFile,
  type ProgressRecord,
  type Bucket,
  type StandaloneMockData,
  type OQSEMeta,
  type MediaObject,
  type FeatureProfile,
} from '@memizy/plugin-sdk';

// ── Constants ──────────────────────────────────────────────────────────────

const TEST_SUITE_URL =
  'https://cdn.jsdelivr.net/gh/memizy/set-test-suite@main/data.oqse.json';

const XSS_PAYLOAD =
  `XSS demo: <img src="x" onerror="alert('XSS fired from unsanitized renderHtml output!')" /> ` +
  `and a <script>document.title='pwned'<\/script> tag.`;

// ── DOM helpers ────────────────────────────────────────────────────────────

function $id<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function $q<T extends Element = Element>(sel: string, ctx: ParentNode = document): T {
  return ctx.querySelector<T>(sel) as T;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

// ── Console ────────────────────────────────────────────────────────────────

const consoleEl = $id('console-panel');

function log(msg: string, kind: 'ok' | 'err' | 'inf' | 'warn' = 'inf'): void {
  const ts = new Date().toLocaleTimeString();
  consoleEl.innerHTML +=
    `<span class="log-ts">${ts}</span><span class="log-${kind}">${esc(msg)}</span><br/>`;
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

// ── Toast ──────────────────────────────────────────────────────────────────

const toastEl = $id('toast');
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function toast(msg: string, kind: 'ok' | 'err' | 'inf' = 'inf'): void {
  toastEl.textContent = msg;
  toastEl.style.background =
    kind === 'ok' ? '#065F46' : kind === 'err' ? '#7F1D1D' : '#111827';
  toastEl.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2600);
}

// ── SDK instance ───────────────────────────────────────────────────────────

const sdk = new MemizySDK({
  id: 'com.memizy.playground.v3',
  version: '0.3.0',
  debug: true,
  standaloneControlsMode: 'hidden', // we provide mockData + our own button
})
  .onConfigUpdate((cfg) => log(`onConfigUpdate: ${JSON.stringify(cfg)}`, 'inf'))
  .onSessionAborted((reason) => {
    log(`onSessionAborted: ${reason}`, 'err');
    toast(`Session aborted: ${reason}`, 'err');
  });

// ── Session state ──────────────────────────────────────────────────────────

let cursor          = 0;
let answeredCount   = 0;
let timerHandle: ReturnType<typeof setInterval> | null = null;
/** Hints consumed via 💡 Hint before the current answer is submitted. */
let hintsUsedThisItem = 0;

// ── Boot ───────────────────────────────────────────────────────────────────

void boot();

async function boot(): Promise<void> {
  log('Fetching OQSE test suite…', 'inf');
  const mockData = await fetchTestSuite();
  log(
    `Test suite fetched: ${mockData.items?.length ?? 0} item(s).`,
    mockData.items?.length ? 'ok' : 'warn',
  );

  try {
    await sdk.connect({ mockData });
  } catch (err) {
    log(`connect() failed: ${String(err)}`, 'err');
    toast('SDK connect failed — see console.', 'err');
    return;
  }

  const items = sdk.store.getItems();
  const meta  = sdk.store.getMeta();

  log(
    `Connected (${sdk.isStandalone ? 'standalone' : 'iframe'}) — ` +
    `${items.length} item(s), set: "${meta?.title ?? 'untitled'}"`,
    'ok',
  );

  // Update UI chrome
  $id('mode-badge').textContent = sdk.isStandalone ? 'Standalone' : 'Iframe';
  $id('items-badge').textContent = `${items.length} item${items.length !== 1 ? 's' : ''}`;
  updateSidebarMeta();

  // Wire all interactive elements
  wireSidebar();
  wireConsole();
  wireStudyTab();
  wireEditTab();
  wireAssetsTab();
  wireTextTab();
  wireProgressTab();
  wireTabSwitching();

  // Kick off study
  if (items.length > 0) {
    renderStudyItem(items[0]!);
  } else {
    renderEmptyCard();
  }

  renderBucketBar();
  renderProgressTable();
}

// ── Fetch OQSE test suite ──────────────────────────────────────────────────

async function fetchTestSuite(): Promise<StandaloneMockData> {
  try {
    const res = await fetch(TEST_SUITE_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const data = (await res.json()) as OQSEFile;
    const assets: Record<string, MediaObject> =
      (data.meta?.assets as Record<string, MediaObject> | undefined) ?? {};
    return {
      items:   data.items   ?? [],
      setMeta: data.meta    ?? undefined,
      assets,
    };
  } catch (err) {
    log(`Test suite fetch failed: ${String(err)} — continuing with empty data.`, 'warn');
    return { items: [], assets: {} };
  }
}

// ── Sidebar meta display ───────────────────────────────────────────────────

function updateSidebarMeta(): void {
  const meta = sdk.store.getMeta();
  $id('sidebar-set-title').textContent = meta?.title ?? 'Untitled Set';
  $id('sidebar-set-desc').textContent  = meta?.description ?? '';
  const items = sdk.store.getItems();
  $id('items-badge').textContent = `${items.length} item${items.length !== 1 ? 's' : ''}`;
}

// ── Tab switching ──────────────────────────────────────────────────────────

function wireTabSwitching(): void {
  document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset['tab'];
      if (!tab) return;
      activateTab(tab);
    });
  });
}

function activateTab(name: string): void {
  document.querySelectorAll<HTMLElement>('.tab-panel').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((b) => b.classList.remove('active'));
  $id(`tab-${name}`).classList.add('active');
  $q<HTMLButtonElement>(`.tab-btn[data-tab="${name}"]`).classList.add('active');

  if (name === 'progress') renderProgressTable();
  if (name === 'edit')     renderItemList();
  if (name === 'assets')   renderAssetGallery();
}

// ── Console wiring ─────────────────────────────────────────────────────────

function wireConsole(): void {
  const wrapper   = $id('console-wrapper');
  const toggleBtn = $id('console-toggle');
  const clearBtn  = $id('console-clear');

  toggleBtn.addEventListener('click', () => {
    const collapsed = wrapper.classList.toggle('collapsed');
    toggleBtn.textContent = collapsed ? '▲' : '▼';
    toggleBtn.setAttribute('aria-label', collapsed ? 'Expand console' : 'Collapse console');
  });

  clearBtn.addEventListener('click', () => {
    consoleEl.innerHTML = '';
    log('Console cleared.', 'inf');
  });
}

// ── Sidebar wiring ─────────────────────────────────────────────────────────

function wireSidebar(): void {
  $id('btn-open-ui').addEventListener('click', () => {
    sdk.openStandaloneUI();
    log('openStandaloneUI() called.', 'inf');
  });

  $id('btn-exit-session').addEventListener('click', async () => {
    const progress = sdk.store.getProgress();
    const total    = Object.keys(progress).length;
    const correct  = Object.values(progress).filter((p) => p.bucket > 1).length;
    const score    = total === 0 ? 0 : Math.round((correct / total) * 100);
    await sdk.sys.exit({ score });
    log(`sys.exit({ score: ${score} }) called.`, 'ok');
    toast(`Session ended. Score: ${score}`, 'ok');
  });
}

// ── Rich text (follow loaded set `meta.requirements`, fallback to markdown) ─

function featureProfileForRichText(): FeatureProfile {
  return sdk.store.getMeta()?.requirements ?? { features: ['markdown'] };
}

function renderRichMarkdown(text: string): string {
  try {
    return sdk.text.renderHtml(text, {
      requirements: featureProfileForRichText(),
      sanitizer: DOMPurify.sanitize,
    });
  } catch {
    return esc(text);
  }
}

function studyExtrasHtml(): string {
  return `
    <div class="study-extras">
      <div id="study-feedback" class="study-feedback hidden"></div>
      <button type="button" id="btn-study-hint" class="btn btn-ghost btn-sm study-hint-btn hidden">💡 Hint</button>
      <div id="study-hint-panel" class="study-hint-panel hidden"></div>
      <div id="item-explanation" class="item-explanation hidden"></div>
    </div>`;
}

function wireStudyHints(item: OQSEItem, scope: HTMLElement): void {
  const btn   = scope.querySelector<HTMLButtonElement>('#btn-study-hint');
  const panel = scope.querySelector<HTMLDivElement>('#study-hint-panel');
  if (!btn || !panel) return;

  const hints = item.hints ?? [];
  if (hints.length === 0) {
    btn.classList.add('hidden');
    return;
  }

  btn.classList.remove('hidden');
  btn.disabled = false;
  panel.classList.add('hidden');
  panel.innerHTML = '';

  let shown = 0;
  btn.textContent = `💡 Hint (${shown}/${hints.length})`;

  btn.onclick = () => {
    const h = hints[shown];
    if (h === undefined) return;
    hintsUsedThisItem += 1;
    panel.classList.remove('hidden');
    const chunk = document.createElement('div');
    chunk.className = 'hint-chunk';
    chunk.innerHTML = renderRichMarkdown(h);
    panel.appendChild(chunk);
    shown += 1;
    btn.textContent =
      shown >= hints.length ? '💡 All hints shown' : `💡 Hint (${shown}/${hints.length})`;
    if (shown >= hints.length) btn.disabled = true;
  };
}

function showPostAnswerPanels(
  scope: HTMLElement,
  item: OQSEItem,
  opts: { incorrect?: boolean },
): void {
  const expl = scope.querySelector<HTMLDivElement>('#item-explanation');
  const feed = scope.querySelector<HTMLDivElement>('#study-feedback');

  if (feed && opts.incorrect && item.incorrectFeedback) {
    feed.classList.remove('hidden');
    feed.innerHTML = renderRichMarkdown(item.incorrectFeedback);
  }

  if (expl && item.explanation) {
    expl.classList.remove('hidden');
    expl.innerHTML = renderRichMarkdown(item.explanation);
  }
}

function shuffleIndices(n: number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  return idx;
}

function checkShortAnswer(
  item: Extract<OQSEItem, { type: 'short-answer' }>,
  raw: string,
): boolean {
  let s = raw;
  if (item.trimWhitespace !== false) s = s.trim();
  const norm = (t: string) =>
    item.caseSensitive === true ? t : t.toLowerCase();
  const user = norm(s);
  return item.answers.some((a) => {
    let t = item.trimWhitespace !== false ? a.trim() : a;
    t = norm(t);
    return t === user;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// STUDY TAB
// ═══════════════════════════════════════════════════════════════════════════

function wireStudyTab(): void {
  $id('btn-reveal').addEventListener('click', revealAnswer);
  $id('btn-correct').addEventListener('click', () => recordFlashcard(true));
  $id('btn-wrong').addEventListener('click', () => recordFlashcard(false));
  $id('btn-skip').addEventListener('click', skipCurrentItem);
  $id('btn-next').addEventListener('click', moveNext);
  $id('btn-restart').addEventListener('click', restartStudy);
  $id('btn-resize').addEventListener('click', () => {
    void sdk.sys.requestResize(640);
    log('sys.requestResize(640) sent.', 'inf');
  });
  $id('btn-report-error').addEventListener('click', () => {
    void sdk.sys.reportError('PLAYGROUND_TEST', 'Non-fatal test error from playground.');
    log('sys.reportError(PLAYGROUND_TEST) sent.', 'warn');
  });
}

function renderStudyItem(item: OQSEItem): void {
  stopTimer();
  hintsUsedThisItem = 0;
  sdk.store.startItemTimer(item.id);
  startTimer(item.id);
  updateBucketDots(item.id);

  if (isFlashcard(item)) renderFlashcard(item);
  else if (isMCQSingle(item)) renderMCQ(item);
  else if (isMCQMulti(item)) renderMCQMulti(item);
  else if (isTrueFalse(item)) renderTrueFalse(item);
  else if (isShortAnswer(item)) renderShortAnswer(item);
  else if (isMatchPairs(item)) renderMatchPairs(item);
  else if (isSortItems(item)) renderSortItems(item);
  else if (isNote(item)) renderNote(item);
  else renderGenericItem(item);
}

function renderEmptyCard(): void {
  const cardArea = $id('card-area');
  cardArea.innerHTML = `
    <div class="card-placeholder">
      <span class="placeholder-icon">📭</span>
      <span>No items in this set.<br />Go to <strong>Edit Set</strong> to add some.</span>
    </div>`;
  setStudyButtonState(false, false, false, false, false);
}

function renderFlashcard(item: Extract<OQSEItem, { type: 'flashcard' }>): void {
  const cardArea = $id('card-area');
  const progress = sdk.store.getProgress();
  const rec      = progress[item.id];
  const bucket   = rec?.bucket ?? 0;
  const pos      = currentPos();

  cardArea.innerHTML = `
    <div class="stage-head">
      <span class="item-type-pill pill-flashcard">Flashcard</span>
      <span class="item-pos-badge">${pos}</span>
    </div>
    <div class="stage-body">
      <div class="item-question">${renderRichMarkdown(item.front)}</div>
      <div class="item-answer" id="fc-answer">${renderRichMarkdown(item.back)}</div>
      ${studyExtrasHtml()}
    </div>`;

  const body = cardArea.querySelector<HTMLElement>('.stage-body')!;
  wireStudyHints(item, body);

  $id('bucket-label').textContent = `Bucket ${bucket} — ${bucketName(bucket)}`;
  setStudyButtonState(true, false, false, true, false);
  setBucketDotActive(bucket);
}

function renderMCQ(item: Extract<OQSEItem, { type: 'mcq-single' }>): void {
  const cardArea = $id('card-area');
  const progress = sdk.store.getProgress();
  const rec      = progress[item.id];
  const bucket   = rec?.bucket ?? 0;
  const pos      = currentPos();
  const letters  = ['A', 'B', 'C', 'D', 'E', 'F'];

  const order = item.shuffleOptions !== false ? shuffleIndices(item.options.length) : item.options.map((_, i) => i);

  const optionsHtml = order
    .map((i) => {
      const opt = item.options[i]!;
      return `
      <button class="mcq-option" data-idx="${i}" type="button">
        <span class="mcq-letter">${letters[i] ?? i + 1}</span>
        <span>${renderRichMarkdown(opt)}</span>
      </button>`;
    })
    .join('');

  cardArea.innerHTML = `
    <div class="stage-head">
      <span class="item-type-pill pill-mcq">MCQ</span>
      <span class="item-pos-badge">${pos}</span>
    </div>
    <div class="stage-body">
      <div class="item-question">${renderRichMarkdown(item.question)}</div>
      <div class="mcq-options" id="mcq-options">${optionsHtml}</div>
      ${studyExtrasHtml()}
    </div>`;

  const body = cardArea.querySelector<HTMLElement>('.stage-body')!;
  wireStudyHints(item, body);

  $id('bucket-label').textContent = `Bucket ${bucket} — ${bucketName(bucket)}`;

  cardArea.querySelectorAll<HTMLButtonElement>('.mcq-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx       = Number(btn.dataset['idx']);
      const isCorrect = idx === item.correctIndex;

      cardArea.querySelectorAll<HTMLButtonElement>('.mcq-option').forEach((b) => {
        b.disabled = true;
        const origI = Number(b.dataset['idx']);
        if (origI === item.correctIndex) b.classList.add('opt-correct');
      });
      if (!isCorrect) btn.classList.add('opt-wrong');

      const rec = sdk.store.answer(item.id, isCorrect, {
        confidence: isCorrect ? 3 : 1,
        hintsUsed: hintsUsedThisItem,
      });
      answeredCount++;
      updateStudyStats(item.id);
      renderBucketBar();

      showPostAnswerPanels(body, item, { incorrect: !isCorrect });
      if (!isCorrect) appendMcqOptionNarratives(body, item, idx);

      log(
        `store.answer("${item.id}", ${isCorrect}) → bucket=${rec.bucket} streak=${rec.stats.streak}`,
        isCorrect ? 'ok' : 'err',
      );
      toast(
        isCorrect ? `Correct! → Bucket ${rec.bucket}` : `Incorrect. Back to bucket ${rec.bucket}`,
        isCorrect ? 'ok' : 'err',
      );

      const delay = item.explanation || item.incorrectFeedback || item.optionExplanations ? 1600 : 950;
      setTimeout(moveNext, delay);
    });
  });

  setStudyButtonState(false, false, false, true, false);
  setBucketDotActive(bucket);
}

function appendMcqOptionNarratives(
  scope: HTMLElement,
  item: Extract<OQSEItem, { type: 'mcq-single' }>,
  pickedIdx: number,
): void {
  const expl = scope.querySelector<HTMLDivElement>('#item-explanation');
  if (!expl || !item.optionExplanations?.length) return;
  const parts: string[] = [];
  const w = item.optionExplanations[pickedIdx];
  if (w) parts.push(`<div class="opt-narr"><strong>Your choice:</strong> ${renderRichMarkdown(w)}</div>`);
  const r = item.optionExplanations[item.correctIndex];
  if (r) parts.push(`<div class="opt-narr"><strong>Correct option:</strong> ${renderRichMarkdown(r)}</div>`);
  if (parts.length === 0) return;
  expl.classList.remove('hidden');
  const base = item.explanation ? renderRichMarkdown(item.explanation) : '';
  expl.innerHTML = (base ? base + '<hr class="expl-hr"/>' : '') + parts.join('');
}

function renderMCQMulti(item: Extract<OQSEItem, { type: 'mcq-multi' }>): void {
  const cardArea = $id('card-area');
  const progress = sdk.store.getProgress();
  const bucket   = progress[item.id]?.bucket ?? 0;
  const pos      = currentPos();
  const letters  = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const order    = item.shuffleOptions !== false ? shuffleIndices(item.options.length) : item.options.map((_, i) => i);

  const optsHtml = order
    .map((i) => {
      const opt = item.options[i]!;
      return `
      <label class="mcq-option mcq-multi-opt" data-idx="${i}">
        <input type="checkbox" data-idx="${i}" />
        <span class="mcq-letter">${letters[i] ?? i + 1}</span>
        <span>${renderRichMarkdown(opt)}</span>
      </label>`;
    })
    .join('');

  cardArea.innerHTML = `
    <div class="stage-head">
      <span class="item-type-pill pill-mcq">MCQ Multi</span>
      <span class="item-pos-badge">${pos}</span>
    </div>
    <div class="stage-body">
      <div class="item-question">${renderRichMarkdown(item.question)}</div>
      <div class="mcq-options" id="mcq-multi-box">${optsHtml}</div>
      <div class="mcq-multi-foot">
        <button type="button" class="btn btn-primary" id="btn-mcq-multi-submit">Submit answers</button>
      </div>
      ${studyExtrasHtml()}
    </div>`;

  const body = cardArea.querySelector<HTMLElement>('.stage-body')!;
  wireStudyHints(item, body);

  $id('bucket-label').textContent = `Bucket ${bucket} — ${bucketName(bucket)}`;

  const selected = new Set<number>();
  const maxSel = item.maxSelections ?? item.options.length;
  const minSel = item.minSelections ?? 1;

  cardArea.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const ix = Number(cb.dataset['idx']);
      if (cb.checked) {
        if (selected.size >= maxSel) {
          cb.checked = false;
          toast(`At most ${maxSel} selection(s).`, 'err');
          return;
        }
        selected.add(ix);
      } else {
        selected.delete(ix);
      }
      const lab = cb.closest('.mcq-option');
      lab?.classList.toggle('selected', cb.checked);
    });
  });

  $id<HTMLButtonElement>('btn-mcq-multi-submit').addEventListener('click', () => {
    if (selected.size < minSel) {
      toast(`Pick at least ${minSel} option(s).`, 'err');
      return;
    }
    const want = new Set(item.correctIndices);
    let ok = want.size === selected.size;
    if (ok) {
      for (const x of selected) {
        if (!want.has(x)) {
          ok = false;
          break;
        }
      }
    } else ok = false;

    cardArea.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((cb) => {
      cb.disabled = true;
    });
    $id<HTMLButtonElement>('btn-mcq-multi-submit').disabled = true;

    cardArea.querySelectorAll<HTMLLabelElement>('.mcq-multi-opt').forEach((lab) => {
      const ix = Number(lab.dataset['idx']);
      if (item.correctIndices.includes(ix)) lab.classList.add('opt-correct');
      else if (selected.has(ix)) lab.classList.add('opt-wrong');
    });

    const rec = sdk.store.answer(item.id, ok, { confidence: ok ? 3 : 1, hintsUsed: hintsUsedThisItem });
    answeredCount++;
    updateStudyStats(item.id);
    renderBucketBar();
    showPostAnswerPanels(body, item, { incorrect: !ok });
    log(`store.answer("${item.id}", ${ok}) [mcq-multi] → bucket=${rec.bucket}`, ok ? 'ok' : 'err');
    toast(ok ? `Correct! → Bucket ${rec.bucket}` : `Incorrect.`, ok ? 'ok' : 'err');
    const delay = item.explanation || item.incorrectFeedback ? 1600 : 950;
    setTimeout(moveNext, delay);
  });

  setStudyButtonState(false, false, false, true, false);
  setBucketDotActive(bucket as Bucket);
}

function renderTrueFalse(item: Extract<OQSEItem, { type: 'true-false' }>): void {
  const cardArea = $id('card-area');
  const progress = sdk.store.getProgress();
  const bucket   = progress[item.id]?.bucket ?? 0;
  const pos      = currentPos();

  cardArea.innerHTML = `
    <div class="stage-head">
      <span class="item-type-pill pill-mcq">True / False</span>
      <span class="item-pos-badge">${pos}</span>
    </div>
    <div class="stage-body">
      <div class="item-question">${renderRichMarkdown(item.question)}</div>
      <div class="tf-row">
        <button type="button" class="btn btn-secondary" id="btn-tf-true">True</button>
        <button type="button" class="btn btn-secondary" id="btn-tf-false">False</button>
      </div>
      ${studyExtrasHtml()}
    </div>`;

  const body = cardArea.querySelector<HTMLElement>('.stage-body')!;
  wireStudyHints(item, body);
  $id('bucket-label').textContent = `Bucket ${bucket} — ${bucketName(bucket)}`;

  const submit = (picked: boolean): void => {
    const ok = picked === item.answer;
    const rec = sdk.store.answer(item.id, ok, { confidence: ok ? 3 : 1, hintsUsed: hintsUsedThisItem });
    answeredCount++;
    updateStudyStats(item.id);
    renderBucketBar();
    showPostAnswerPanels(body, item, { incorrect: !ok });
    $id<HTMLButtonElement>('btn-tf-true').disabled = true;
    $id<HTMLButtonElement>('btn-tf-false').disabled = true;
    log(`store.answer("${item.id}", ${ok}) [t/f] → bucket=${rec.bucket}`, ok ? 'ok' : 'err');
    toast(ok ? `Correct!` : `Incorrect.`, ok ? 'ok' : 'err');
    const delay = item.explanation || item.incorrectFeedback ? 1600 : 900;
    setTimeout(moveNext, delay);
  };

  $id<HTMLButtonElement>('btn-tf-true').addEventListener('click', () => submit(true));
  $id<HTMLButtonElement>('btn-tf-false').addEventListener('click', () => submit(false));

  setStudyButtonState(false, false, false, true, false);
  setBucketDotActive(bucket as Bucket);
}

function renderShortAnswer(item: Extract<OQSEItem, { type: 'short-answer' }>): void {
  const cardArea = $id('card-area');
  const progress = sdk.store.getProgress();
  const bucket   = progress[item.id]?.bucket ?? 0;
  const pos      = currentPos();

  cardArea.innerHTML = `
    <div class="stage-head">
      <span class="item-type-pill pill-other">Short answer</span>
      <span class="item-pos-badge">${pos}</span>
    </div>
    <div class="stage-body">
      <div class="item-question">${renderRichMarkdown(item.question)}</div>
      <div class="short-answer-row">
        <input type="text" class="form-input" id="short-answer-input" placeholder="Your answer…" autocomplete="off" />
        <button type="button" class="btn btn-primary" id="btn-short-submit">Submit</button>
      </div>
      ${studyExtrasHtml()}
    </div>`;

  const body = cardArea.querySelector<HTMLElement>('.stage-body')!;
  wireStudyHints(item, body);
  $id('bucket-label').textContent = `Bucket ${bucket} — ${bucketName(bucket)}`;

  const input = $id<HTMLInputElement>('short-answer-input');
  const go = (): void => {
    const ok = checkShortAnswer(item, input.value);
    const rec = sdk.store.answer(item.id, ok, { confidence: ok ? 3 : 1, hintsUsed: hintsUsedThisItem, answer: input.value });
    answeredCount++;
    updateStudyStats(item.id);
    renderBucketBar();
    showPostAnswerPanels(body, item, { incorrect: !ok });
    $id<HTMLButtonElement>('btn-short-submit').disabled = true;
    input.disabled = true;
    log(`store.answer("${item.id}", ${ok}) [short] → bucket=${rec.bucket}`, ok ? 'ok' : 'err');
    toast(ok ? `Correct!` : `Incorrect.`, ok ? 'ok' : 'err');
    const delay = item.explanation || item.incorrectFeedback ? 1600 : 900;
    setTimeout(moveNext, delay);
  };

  $id<HTMLButtonElement>('btn-short-submit').addEventListener('click', go);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') go();
  });

  setStudyButtonState(false, false, false, true, false);
  setBucketDotActive(bucket as Bucket);
}

function renderMatchPairs(item: Extract<OQSEItem, { type: 'match-pairs' }>): void {
  const cardArea = $id('card-area');
  const progress = sdk.store.getProgress();
  const bucket   = progress[item.id]?.bucket ?? 0;
  const pos      = currentPos();

  const rows = item.prompts
    .map((prompt, i) => {
      const shuf = shuffleIndices(item.matches.length);
      const opts = shuf
        .map((mi) => `<option value="${mi}">${esc(item.matches[mi]!)}</option>`)
        .join('');
      return `
        <div class="match-row" data-prompt-i="${i}">
          <div class="match-prompt">${renderRichMarkdown(prompt)}</div>
          <select class="match-select" data-prompt-i="${i}" aria-label="Match for prompt ${i + 1}">
            <option value="">— Choose —</option>
            ${opts}
          </select>
        </div>`;
    })
    .join('');

  cardArea.innerHTML = `
    <div class="stage-head">
      <span class="item-type-pill pill-other">Match pairs</span>
      <span class="item-pos-badge">${pos}</span>
    </div>
    <div class="stage-body">
      ${item.question ? `<div class="item-question">${renderRichMarkdown(item.question)}</div>` : ''}
      <div class="match-grid">${rows}</div>
      <div class="mcq-multi-foot">
        <button type="button" class="btn btn-primary" id="btn-match-submit">Submit matches</button>
      </div>
      ${studyExtrasHtml()}
    </div>`;

  const body = cardArea.querySelector<HTMLElement>('.stage-body')!;
  wireStudyHints(item, body);
  $id('bucket-label').textContent = `Bucket ${bucket} — ${bucketName(bucket)}`;

  $id<HTMLButtonElement>('btn-match-submit').addEventListener('click', () => {
    let ok = true;
    item.prompts.forEach((_, i) => {
      const sel = body.querySelector<HTMLSelectElement>(`select[data-prompt-i="${i}"]`);
      const v   = sel?.value ?? '';
      if (v === '' || Number(v) !== i) ok = false;
    });

    body.querySelectorAll<HTMLSelectElement>('.match-select').forEach((s) => {
      s.disabled = true;
    });
    $id<HTMLButtonElement>('btn-match-submit').disabled = true;

    const rec = sdk.store.answer(item.id, ok, { confidence: ok ? 3 : 1, hintsUsed: hintsUsedThisItem });
    answeredCount++;
    updateStudyStats(item.id);
    renderBucketBar();
    showPostAnswerPanels(body, item, { incorrect: !ok });
    log(`store.answer("${item.id}", ${ok}) [match] → bucket=${rec.bucket}`, ok ? 'ok' : 'err');
    toast(ok ? `All pairs correct!` : `Some pairs are wrong.`, ok ? 'ok' : 'err');
    const delay = item.explanation || item.incorrectFeedback ? 1600 : 950;
    setTimeout(moveNext, delay);
  });

  setStudyButtonState(false, false, false, true, false);
  setBucketDotActive(bucket as Bucket);
}

function renderSortItems(item: Extract<OQSEItem, { type: 'sort-items' }>): void {
  const cardArea = $id('card-area');
  const progress = sdk.store.getProgress();
  const bucket   = progress[item.id]?.bucket ?? 0;
  const pos      = currentPos();

  const labels = [...item.items];
  for (let i = labels.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [labels[i], labels[j]] = [labels[j]!, labels[i]!];
  }

  const lis = labels
    .map(
      (lab) => `
    <li data-src="${encodeURIComponent(lab)}">
      <span class="sort-label">${renderRichMarkdown(lab)}</span>
      <div class="sort-btns">
        <button type="button" class="btn btn-ghost btn-sm sort-up" aria-label="Move up">↑</button>
        <button type="button" class="btn btn-ghost btn-sm sort-down" aria-label="Move down">↓</button>
      </div>
    </li>`,
    )
    .join('');

  cardArea.innerHTML = `
    <div class="stage-head">
      <span class="item-type-pill pill-other">Sort</span>
      <span class="item-pos-badge">${pos}</span>
    </div>
    <div class="stage-body">
      <div class="item-question">${renderRichMarkdown(item.question)}</div>
      <p class="text-muted" style="font-size:13px;color:var(--mz-text-muted);margin:0">Use ↑ ↓ to reorder, then submit.</p>
      <ul id="sort-ul" class="sort-list">${lis}</ul>
      <div class="mcq-multi-foot">
        <button type="button" class="btn btn-primary" id="btn-sort-submit">Submit order</button>
      </div>
      ${studyExtrasHtml()}
    </div>`;

  const body  = cardArea.querySelector<HTMLElement>('.stage-body')!;
  const ul    = $id<HTMLUListElement>('sort-ul');
  wireStudyHints(item, body);
  $id('bucket-label').textContent = `Bucket ${bucket} — ${bucketName(bucket)}`;

  ul.querySelectorAll<HTMLButtonElement>('.sort-up').forEach((btn) => {
    btn.addEventListener('click', () => {
      const li = btn.closest('li');
      const prev = li?.previousElementSibling;
      if (li && prev) ul.insertBefore(li, prev);
    });
  });
  ul.querySelectorAll<HTMLButtonElement>('.sort-down').forEach((btn) => {
    btn.addEventListener('click', () => {
      const li = btn.closest('li');
      const next = li?.nextElementSibling;
      if (li && next) ul.insertBefore(next, li);
    });
  });

  $id<HTMLButtonElement>('btn-sort-submit').addEventListener('click', () => {
    const got = [...ul.querySelectorAll<HTMLLIElement>('li')].map((li) =>
      decodeURIComponent(li.dataset['src'] ?? ''),
    );
    const ok =
      got.length === item.items.length && got.every((g, i) => g === item.items[i]);

    $id<HTMLButtonElement>('btn-sort-submit').disabled = true;
    ul.querySelectorAll('button').forEach((b) => {
      (b as HTMLButtonElement).disabled = true;
    });

    const rec = sdk.store.answer(item.id, ok, { confidence: ok ? 3 : 1, hintsUsed: hintsUsedThisItem });
    answeredCount++;
    updateStudyStats(item.id);
    renderBucketBar();
    showPostAnswerPanels(body, item, { incorrect: !ok });
    log(`store.answer("${item.id}", ${ok}) [sort] → bucket=${rec.bucket}`, ok ? 'ok' : 'err');
    toast(ok ? `Correct order!` : `Order does not match.`, ok ? 'ok' : 'err');
    const delay = item.explanation || item.incorrectFeedback ? 1600 : 950;
    setTimeout(moveNext, delay);
  });

  setStudyButtonState(false, false, false, true, false);
  setBucketDotActive(bucket as Bucket);
}

function renderNote(item: Extract<OQSEItem, { type: 'note' }>): void {
  const cardArea = $id('card-area');
  const progress = sdk.store.getProgress();
  const bucket   = progress[item.id]?.bucket ?? 0;
  const pos      = currentPos();

  const title = item.title ? `<h3 class="note-title">${esc(item.title)}</h3>` : '';
  const hidden = item.hiddenContent
    ? `<div id="note-hidden-wrap" class="hidden"><div class="item-answer visible" style="margin-top:12px">${renderRichMarkdown(item.hiddenContent)}</div></div>
       <button type="button" class="btn btn-ghost btn-sm" id="btn-note-reveal" style="margin-top:8px">Show more</button>`
    : '';

  cardArea.innerHTML = `
    <div class="stage-head">
      <span class="item-type-pill pill-other">Note</span>
      <span class="item-pos-badge">${pos}</span>
    </div>
    <div class="stage-body">
      ${title}
      <div class="item-question" style="text-align:left;font-size:1.05rem">${renderRichMarkdown(item.content)}</div>
      ${hidden}
      ${studyExtrasHtml()}
      <div class="note-actions">
        <button type="button" class="btn btn-primary" id="btn-note-continue">Continue</button>
      </div>
    </div>`;

  const body = cardArea.querySelector<HTMLElement>('.stage-body')!;
  wireStudyHints(item, body);
  $id('bucket-label').textContent = `Bucket ${bucket} — ${bucketName(bucket)}`;

  const revealBtn = body.querySelector<HTMLButtonElement>('#btn-note-reveal');
  if (revealBtn) {
    revealBtn.addEventListener('click', () => {
      const w = $id('note-hidden-wrap');
      w.classList.remove('hidden');
      revealBtn.classList.add('hidden');
    });
  }

  $id<HTMLButtonElement>('btn-note-continue').addEventListener('click', () => {
    sdk.store.skip(item.id);
    showPostAnswerPanels(body, item, {});
    log(`store.skip("${item.id}") [note continue]`, 'inf');
    moveNext();
  });

  setStudyButtonState(false, false, false, true, false);
  setBucketDotActive(bucket as Bucket);
}

function renderGenericItem(item: OQSEItem): void {
  const cardArea = $id('card-area');
  const pos = currentPos();
  cardArea.innerHTML = `
    <div class="stage-head">
      <span class="item-type-pill pill-other">${esc(item.type)}</span>
      <span class="item-pos-badge">${pos}</span>
    </div>
    <div class="stage-body">
      <div class="item-question" style="font-size:1rem;color:var(--mz-text-muted)">
        This playground does not yet render <strong>${esc(item.type)}</strong>.<br/>
        Item ID: <code>${esc(item.id)}</code>
      </div>
      ${studyExtrasHtml()}
    </div>`;
  const body = cardArea.querySelector<HTMLElement>('.stage-body')!;
  wireStudyHints(item, body);
  setStudyButtonState(false, false, false, true, true);
}

function revealAnswer(): void {
  const answerEl = document.getElementById('fc-answer');
  if (!answerEl) return;
  answerEl.classList.add('visible');
  setStudyButtonState(false, true, true, true, true);
  const items = sdk.store.getItems();
  const item  = items[cursor];
  const body    = $id('card-area').querySelector<HTMLElement>('.stage-body');
  if (item && isFlashcard(item) && body) {
    showPostAnswerPanels(body, item, {});
  }
}

function recordFlashcard(isCorrect: boolean): void {
  const items = sdk.store.getItems();
  const item  = items[cursor];
  if (!item || !isFlashcard(item)) return;

  const body = $id('card-area').querySelector<HTMLElement>('.stage-body');

  const rec = sdk.store.answer(item.id, isCorrect, {
    confidence: isCorrect ? 4 : 1,
    hintsUsed: hintsUsedThisItem,
  });
  answeredCount++;
  updateStudyStats(item.id);
  renderBucketBar();

  if (body) showPostAnswerPanels(body, item, { incorrect: !isCorrect });

  log(
    `store.answer("${item.id}", ${isCorrect}) → bucket=${rec.bucket} streak=${rec.stats.streak}`,
    isCorrect ? 'ok' : 'err',
  );
  toast(isCorrect ? `Correct! → Bucket ${rec.bucket}` : `Back to bucket ${rec.bucket}`, isCorrect ? 'ok' : 'err');
  const delay = item.explanation || item.incorrectFeedback ? 1600 : 900;
  setTimeout(moveNext, delay);
}

function skipCurrentItem(): void {
  const items = sdk.store.getItems();
  const item  = items[cursor];
  if (!item) return;

  sdk.store.skip(item.id);
  log(`store.skip("${item.id}")`, 'warn');
  toast('Skipped.', 'inf');
  moveNext();
}

function lastAnswerTs(itemId: string): number {
  const raw = sdk.store.getProgress()[itemId]?.lastAnswer?.answeredAt;
  if (!raw) return 0;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? 0 : t;
}

function moveNext(): void {
  const items = sdk.store.getItems();
  if (items.length === 0) {
    renderEmptyCard();
    return;
  }

  const progress = sdk.store.getProgress();
  const ranked   = items
    .map((item, index) => ({
      index,
      bucket: progress[item.id]?.bucket ?? 0,
      answeredAt: lastAnswerTs(item.id),
    }))
    .sort((a, b) => {
      if (a.bucket !== b.bucket) return a.bucket - b.bucket;
      if (a.answeredAt !== b.answeredAt) return a.answeredAt - b.answeredAt;
      return a.index - b.index;
    });

  const next = ranked.find((e) => e.index !== cursor) ?? ranked[0];
  if (next) cursor = next.index;

  const item = items[cursor];
  if (item) renderStudyItem(item);
}

function restartStudy(): void {
  cursor = 0;
  answeredCount = 0;
  hintsUsedThisItem = 0;
  const items = sdk.store.getItems();
  if (items.length > 0 && items[0]) {
    renderStudyItem(items[0]);
    renderBucketBar();
    log('Study session restarted.', 'inf');
  }
}

function currentPos(): string {
  const items = sdk.store.getItems();
  return `${cursor + 1} / ${items.length}`;
}

// ── Bucket helpers ─────────────────────────────────────────────────────────

const BUCKET_NAMES: Record<Bucket, string> = {
  0: 'New',
  1: 'Learning',
  2: 'Familiar',
  3: 'Consolidated',
  4: 'Mastered',
};

function bucketName(b: Bucket): string { return BUCKET_NAMES[b]; }

function setBucketDotActive(bucket: Bucket): void {
  for (let i = 0; i <= 4; i++) {
    $id(`bdot${i}`).classList.toggle('active', i === bucket);
  }
}

function updateBucketDots(itemId: string): void {
  const rec    = sdk.store.getProgress()[itemId];
  const bucket = (rec?.bucket ?? 0) as Bucket;
  setBucketDotActive(bucket);
  $id('bucket-label').textContent = `Bucket ${bucket} — ${bucketName(bucket)}`;
  updateStudyStats(itemId);
}

function updateStudyStats(itemId: string): void {
  const rec = sdk.store.getProgress()[itemId];
  $id('stat-attempts').textContent = String(rec?.stats.attempts ?? 0);
  $id('stat-streak').textContent   = String(rec?.stats.streak   ?? 0);
  $id('stat-answered').textContent = String(answeredCount);
}

function renderBucketBar(): void {
  const bar      = $id('bucket-bar');
  const items    = sdk.store.getItems();
  const progress = sdk.store.getProgress();
  const total    = items.length;

  if (total === 0) {
    bar.innerHTML = '';
    for (let i = 0; i <= 4; i++) $id(`bc${i}`).textContent = '0';
    return;
  }

  const counts: Record<Bucket, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const item of items) {
    const b = (progress[item.id]?.bucket ?? 0) as Bucket;
    counts[b] += 1;
  }

  bar.innerHTML = '';
  ([4, 3, 2, 1, 0] as const).forEach((b) => {
    const count = counts[b];
    $id(`bc${b}`).textContent = String(count);
    if (count === 0) return;
    const seg = document.createElement('div');
    seg.className = `bucket-seg s${b}`;
    seg.style.width = `${(count / total) * 100}%`;
    seg.title = `Bucket ${b}: ${count} item(s)`;
    bar.appendChild(seg);
  });
}

// ── Timer ──────────────────────────────────────────────────────────────────

function startTimer(_itemId: string): void {
  stopTimer();
  timerHandle = setInterval(() => {
    // Timer is tracked internally by sdk.store — this setInterval is only
    // for display purposes if you want to show elapsed time in a UI element.
  }, 1000);
}

function stopTimer(): void {
  if (timerHandle !== null) {
    clearInterval(timerHandle);
    timerHandle = null;
  }
}

// ── Study button state helper ──────────────────────────────────────────────

function setStudyButtonState(
  reveal: boolean,
  correct: boolean,
  wrong: boolean,
  skip: boolean,
  next: boolean,
): void {
  ($id('btn-reveal')  as HTMLButtonElement).disabled = !reveal;
  ($id('btn-correct') as HTMLButtonElement).disabled = !correct;
  ($id('btn-wrong')   as HTMLButtonElement).disabled = !wrong;
  ($id('btn-skip')    as HTMLButtonElement).disabled = !skip;
  ($id('btn-next')    as HTMLButtonElement).disabled = !next;
}

// ═══════════════════════════════════════════════════════════════════════════
// EDIT SET TAB
// ═══════════════════════════════════════════════════════════════════════════

function wireEditTab(): void {
  // Populate meta fields from loaded set
  const meta = sdk.store.getMeta();
  $id<HTMLInputElement>('meta-title').value = meta?.title ?? '';
  $id<HTMLInputElement>('meta-desc').value  = meta?.description ?? '';

  $id('btn-save-meta').addEventListener('click', () => void saveMeta());
  $id('btn-add-item').addEventListener('click', () => void addNewItem());
  $id('btn-clear-new-item').addEventListener('click', clearNewItemForm);
}

async function saveMeta(): Promise<void> {
  const title = $id<HTMLInputElement>('meta-title').value.trim();
  const desc  = $id<HTMLInputElement>('meta-desc').value.trim();

  if (!title) { toast('Title cannot be empty.', 'err'); return; }

  await sdk.store.updateMeta((draft: OQSEMeta) => {
    draft.title = title;
    if (desc) draft.description = desc;
  });

  updateSidebarMeta();
  log(`store.updateMeta({ title: "${title}", description: "${desc}" })`, 'ok');
  toast('Metadata saved.', 'ok');
}

async function addNewItem(): Promise<void> {
  const front = $id<HTMLInputElement>('new-item-front').value.trim();
  const back  = $id<HTMLTextAreaElement>('new-item-back').value.trim();

  if (!front) { toast('Front text is required.', 'err'); return; }
  if (!back)  { toast('Back text is required.', 'err');  return; }

  const newItem: OQSEItem = {
    id:    generateUUID(),
    type:  'flashcard',
    front,
    back,
  };

  await sdk.store.createItem(newItem);
  updateSidebarMeta();
  log(`store.createItem({ id: "${newItem.id}", type: "flashcard" })`, 'ok');
  toast('Item added.', 'ok');
  clearNewItemForm();
  renderItemList();
}

function clearNewItemForm(): void {
  $id<HTMLInputElement>('new-item-front').value   = '';
  $id<HTMLTextAreaElement>('new-item-back').value = '';
}

function renderItemList(): void {
  const items    = sdk.store.getItems();
  const progress = sdk.store.getProgress();
  const list     = $id('item-list');
  const countEl  = $id('item-count');

  countEl.textContent = String(items.length);

  if (items.length === 0) {
    list.innerHTML = '<div class="empty-state">No items yet. Add one below.</div>';
    return;
  }

  list.innerHTML = items
    .map((item) => {
      const bucket  = progress[item.id]?.bucket ?? 0;
      const prompt  = getItemPrompt(item);
      const typeTag = item.type === 'flashcard' ? 'tag-flashcard' : item.type === 'mcq-single' ? 'tag-mcq' : 'tag-other';
      return `
        <div class="item-row">
          <span class="item-type-tag ${typeTag}">${esc(item.type)}</span>
          <span class="item-prompt" title="${esc(prompt)}">${esc(prompt.slice(0, 70))}</span>
          <span class="bucket-pill bp${bucket}">B${bucket}</span>
          <button class="btn btn-ghost btn-sm" data-delete="${esc(item.id)}" type="button"
                  aria-label="Delete item" title="Delete">✕</button>
        </div>`;
    })
    .join('');

  list.querySelectorAll<HTMLButtonElement>('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset['delete']!;
      void deleteItem(id);
    });
  });
}

async function deleteItem(id: string): Promise<void> {
  const deleted = await sdk.store.deleteItem(id);
  if (!deleted) { toast('Item not found.', 'err'); return; }
  log(`store.deleteItem("${id}")`, 'warn');
  toast('Item deleted.', 'inf');
  updateSidebarMeta();
  renderItemList();
  // Adjust cursor if needed
  const items = sdk.store.getItems();
  if (cursor >= items.length) cursor = Math.max(0, items.length - 1);
}

function getItemPrompt(item: OQSEItem): string {
  if (isFlashcard(item)) return item.front;
  if (isMCQSingle(item) || isMCQMulti(item)) return item.question;
  if (isTrueFalse(item)) return item.question;
  if (isShortAnswer(item)) return item.question;
  if (isMatchPairs(item)) return item.question ?? item.prompts.join(' · ');
  if (isSortItems(item)) return item.question;
  if (isNote(item)) return item.title ?? item.content.slice(0, 80);
  return item.id;
}

// ═══════════════════════════════════════════════════════════════════════════
// ASSETS TAB
// ═══════════════════════════════════════════════════════════════════════════

function wireAssetsTab(): void {
  $id('btn-upload-asset').addEventListener('click', () => void uploadAsset());
}

async function uploadAsset(): Promise<void> {
  const keyInput  = $id<HTMLInputElement>('asset-key');
  const fileInput = $id<HTMLInputElement>('asset-file');
  const key       = keyInput.value.trim();
  const file      = fileInput.files?.[0];

  if (!key)  { toast('Asset key is required.', 'err');  return; }
  if (!file) { toast('No file selected.', 'err'); return; }

  log(`assets.upload("${key}", ${file.name} [${file.type}])…`, 'inf');
  try {
    const media = await sdk.assets.upload(file, key);
    log(
      `assets.upload resolved → type=${media.type} url=${media.value.slice(0, 48)}…`,
      'ok',
    );
    toast(`Asset "${key}" uploaded.`, 'ok');
    keyInput.value  = '';
    fileInput.value = '';
    renderAssetGallery();
  } catch (err) {
    log(`assets.upload failed: ${String(err)}`, 'err');
    toast('Upload failed — see log.', 'err');
  }
}

function renderAssetGallery(): void {
  const assets  = sdk.assets.all();
  const keys    = Object.keys(assets);
  const empty   = $id('asset-empty');
  const gallery = $id('asset-gallery');

  if (keys.length === 0) {
    empty.classList.remove('hidden');
    gallery.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  gallery.classList.remove('hidden');

  gallery.innerHTML = keys
    .map((key) => {
      const media   = assets[key]!;
      const isImage = media.type === 'image';
      const thumb   = isImage
        ? `<img src="${esc(media.value)}" alt="${esc(media.altText ?? key)}" loading="lazy" />`
        : `<span class="asset-icon">${media.type === 'audio' ? '🎵' : media.type === 'video' ? '🎬' : '📄'}</span>`;
      return `
        <div class="asset-card">
          <div class="asset-thumb">${thumb}</div>
          <div class="asset-info">
            <div class="asset-key" title="${esc(key)}">${esc(key)}</div>
            <div class="asset-actions">
              <button class="btn btn-ghost btn-sm" data-copy="${esc(key)}" type="button">📋 Copy key</button>
            </div>
          </div>
        </div>`;
    })
    .join('');

  gallery.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset['copy']!;
      void navigator.clipboard.writeText(key);
      toast(`Key "${key}" copied.`, 'ok');
      log(`Copied asset key "${key}" to clipboard.`, 'ok');
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// TEXT PROCESSING TAB
// ═══════════════════════════════════════════════════════════════════════════

function wireTextTab(): void {
  $id('btn-inject-xss').addEventListener('click', () => {
    $id<HTMLTextAreaElement>('text-input').value = XSS_PAYLOAD;
    log('XSS payload injected. Use "B · Tier 2 Unsafe" to see the alert fire.', 'warn');
    toast('XSS payload ready — click "B · Tier 2 Unsafe" to trigger the alert.', 'inf');
  });

  $id('btn-use-current-item').addEventListener('click', () => {
    const items = sdk.store.getItems();
    const item  = items[cursor];
    if (!item) { toast('No current item.', 'err'); return; }
    const text = getItemPrompt(item);
    $id<HTMLTextAreaElement>('text-input').value = text;
    log(`Loaded current item text (${item.id}) into text input.`, 'inf');
  });

  $id('btn-render-tier1').addEventListener('click', renderTier1);
  $id('btn-render-tier2-unsafe').addEventListener('click', renderTier2Unsafe);
  $id('btn-render-tier2-safe').addEventListener('click', renderTier2Safe);
  $id('btn-tokenize').addEventListener('click', renderTokenized);
}

function getTextInput(): string {
  return $id<HTMLTextAreaElement>('text-input').value;
}

/**
 * Case A — Tier 1: Pure Markdown, no HTML allowed.
 * requirements: { features: [] } causes prepareRichTextForDisplay to call
 * validateTier1Markdown(), which throws if it finds raw HTML tags in the input.
 */
function renderTier1(): void {
  const raw    = getTextInput();
  const output = $id('output-tier1');
  try {
    const html = sdk.text.renderHtml(raw, { requirements: { features: [] } });
    output.innerHTML = html;
    log('A · Tier 1 renderHtml() succeeded — no HTML tags in input.', 'ok');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    output.innerHTML = `<div class="render-error">⛔ Validation error: ${esc(msg)}</div>`;
    log(`A · Tier 1 renderHtml() threw: ${msg}`, 'err');
    toast('Tier 1 validation error — raw HTML is not allowed. See log.', 'err');
  }
}

/**
 * Case B — Tier 2: HTML allowed, NO sanitizer.
 * requirements: { features: ['html'] } disables Tier 1 validation.
 * Without a sanitizer the raw HTML is inserted verbatim → XSS executes.
 */
function renderTier2Unsafe(): void {
  const raw    = getTextInput();
  const output = $id('output-tier2-unsafe');
  try {
    const html = sdk.text.renderHtml(raw, { requirements: { features: ['html'] } });
    output.innerHTML = html;
    log('B · Tier 2 (unsafe) renderHtml() — raw HTML inserted, XSS may execute!', 'warn');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    output.innerHTML = `<div class="render-error">⛔ Error: ${esc(msg)}</div>`;
    log(`B · Tier 2 (unsafe) renderHtml() threw: ${msg}`, 'err');
  }
}

/**
 * Case C — Tier 2: HTML allowed + DOMPurify sanitizer.
 * Same as Case B but passes DOMPurify.sanitize, which strips event handlers
 * and dangerous tags before DOM insertion.
 */
function renderTier2Safe(): void {
  const raw    = getTextInput();
  const output = $id('output-tier2-safe');
  try {
    const html = sdk.text.renderHtml(raw, {
      requirements: { features: ['html'] },
      sanitizer: DOMPurify.sanitize,
    });
    output.innerHTML = html;
    log('C · Tier 2 (safe) renderHtml() with DOMPurify — output sanitized.', 'ok');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    output.innerHTML = `<div class="render-error">⛔ Error: ${esc(msg)}</div>`;
    log(`C · Tier 2 (safe) renderHtml() threw: ${msg}`, 'err');
  }
}

function renderTokenized(): void {
  const raw    = getTextInput();
  const tokens = sdk.text.parseTokens(raw);

  const html = tokens
    .map((token) => {
      if (token.type === 'text') return esc(token.value);
      if (token.type === 'blank') {
        return `<input type="text" placeholder="${esc(token.key)}" class="oqse-blank" />`;
      }
      const media = token.media;
      if (!media) return `<span style="opacity:.5">[asset:${esc(token.key)}]</span>`;
      const url = esc(media.value);
      const alt = esc(media.altText ?? token.key);
      if (media.type === 'image') return `<img src="${url}" alt="${alt}" class="oqse-asset-img" />`;
      if (media.type === 'audio') return `<audio controls src="${url}"></audio>`;
      if (media.type === 'video') return `<video controls src="${url}" style="max-width:100%"></video>`;
      return `<span style="opacity:.5">[${esc(media.type)}:${esc(token.key)}]</span>`;
    })
    .join('');

  $id('output-tokens').innerHTML = html;
  $id('output-token-json').textContent = JSON.stringify(tokens, null, 2);
  log(`text.parseTokens(raw) → ${tokens.length} token(s).`, 'ok');
}

// ═══════════════════════════════════════════════════════════════════════════
// PROGRESS TAB
// ═══════════════════════════════════════════════════════════════════════════

function wireProgressTab(): void {
  $id('btn-refresh-progress').addEventListener('click', () => {
    renderProgressTable();
    const n = Object.keys(sdk.store.getProgress()).length;
    log(`Progress refreshed — ${n} record(s).`, 'ok');
  });

  $id('btn-export-progress').addEventListener('click', exportProgress);
}

function renderProgressTable(): void {
  const tbody    = $id('progress-tbody');
  const progress = sdk.store.getProgress();
  const items    = sdk.store.getItems();
  const keys     = Object.keys(progress);

  if (keys.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No progress yet — study some items first.</td></tr>`;
    return;
  }

  tbody.innerHTML = keys
    .map((id) => {
      const rec  = progress[id] as ProgressRecord;
      const item = items.find((it) => it.id === id);
      const type = item?.type ?? '—';
      return `
        <tr>
          <td><code title="${esc(id)}">${esc(id.slice(0, 12))}…</code></td>
          <td><span class="item-type-tag ${type === 'flashcard' ? 'tag-flashcard' : type === 'mcq-single' ? 'tag-mcq' : 'tag-other'}">${esc(type)}</span></td>
          <td><span class="bucket-badge bb${rec.bucket}">${rec.bucket}</span></td>
          <td>${rec.stats.streak}</td>
          <td>${rec.stats.attempts}</td>
          <td>${fmtDate(rec.lastAnswer?.answeredAt)}</td>
          <td>${fmtDate(rec.nextReviewAt)}</td>
        </tr>`;
    })
    .join('');
}

function exportProgress(): void {
  const progress = sdk.store.getProgress();
  const meta     = sdk.store.getMeta();
  const payload  = {
    version: '1.0',
    setId:   meta?.id ?? 'unknown',
    records: progress,
  };
  const data = JSON.stringify(payload, null, 2);
  const url  = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'session.oqsep';
  a.click();
  URL.revokeObjectURL(url);
  log(`Exported ${Object.keys(progress).length} progress records as session.oqsep.`, 'ok');
}
