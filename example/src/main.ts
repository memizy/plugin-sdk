/**
 * Memizy Flashcard Example
 *
 * A minimal, brand-aligned plugin that exercises the full SDK surface:
 *  - connect()          with `mockData` fallback + URL `?set=` support
 *  - sdk.store          getItem, startItemTimer, answer, skip, getProgress
 *  - sdk.text           renderHtml(...) with default (safe-ish) settings
 *  - sdk.sys            requestResize, exit, reportError
 *  - sdk.openStandaloneUI() trigger
 *  - lifecycle          onConfigUpdate, onSessionAborted
 */

import {
  MemizySDK,
  isFlashcard,
  isMCQSingle,
  type OQSEItem,
  type ProgressRecord,
  type Bucket,
} from '@memizy/plugin-sdk';

import { SAMPLE_ITEMS, SAMPLE_ASSETS } from './sample-set';

// -- DOM helpers ------------------------------------------------------------

const $ = <T extends Element = HTMLElement>(sel: string): T =>
  document.querySelector<T>(sel) as T;

const toast = (msg: string, kind: 'info' | 'ok' | 'error' = 'info') => {
  const el = $('#toast');
  el.textContent = msg;
  el.style.background =
    kind === 'ok' ? '#065F46' : kind === 'error' ? '#7F1D1D' : '#111827';
  el.classList.remove('mz-hidden');
  window.clearTimeout((toast as unknown as { _t?: number })._t);
  (toast as unknown as { _t?: number })._t = window.setTimeout(() => {
    el.classList.add('mz-hidden');
  }, 2400);
};

// -- Boot -------------------------------------------------------------------

const sdk = new MemizySDK({
  id: 'com.memizy.example.flashcard',
  version: '1.0.0',
  debug: true,
  standaloneControlsMode: 'auto',
  standaloneUiPosition: 'bottom-right',
})
  .onConfigUpdate((cfg) => toast(`Config updated: ${JSON.stringify(cfg)}`, 'info'))
  .onSessionAborted((reason) => toast(`Session aborted: ${reason}`, 'error'));

let currentIndex = 0;
let timerHandle: number | null = null;

void boot();

async function boot(): Promise<void> {
  try {
    await sdk.connect({
      mockData: { items: SAMPLE_ITEMS, assets: SAMPLE_ASSETS },
    });
  } catch (err) {
    console.error(err);
    toast(`Failed to connect: ${(err as Error).message}`, 'error');
    return;
  }

  $<HTMLSpanElement>('#mode-note').textContent = sdk.isStandalone
    ? 'standalone dev mode'
    : 'embedded (iframe)';

  wireControls();
  renderAll();

  // Give the host a nice, compact iframe size in production.
  if (!sdk.isStandalone) await sdk.sys.requestResize(560);
}

function wireControls(): void {
  $<HTMLButtonElement>('#open-loader').addEventListener('click', () => {
    sdk.openStandaloneUI();
  });

  $<HTMLButtonElement>('#flip-btn').addEventListener('click', flip);
  $<HTMLButtonElement>('#skip-btn').addEventListener('click', () => {
    const item = currentItem();
    if (!item) return;
    sdk.store.skip(item.id);
    toast('Skipped.', 'info');
    advance();
  });

  $('#answer-group').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-correct]');
    if (!btn) return;
    const item = currentItem();
    if (!item) return;
    const isCorrect = btn.dataset['correct'] === 'true';
    const record = sdk.store.answer(item.id, isCorrect, {
      confidence: isCorrect ? 3 : 1,
    });
    toast(
      isCorrect
        ? `Nice! Bucket → ${record.bucket}`
        : `Resetting to bucket 1.`,
      isCorrect ? 'ok' : 'error',
    );
    advance();
  });

  $<HTMLButtonElement>('#reset-btn').addEventListener('click', async () => {
    try {
      await sdk.store.syncProgress({}); // host-side clear, no-op for records
      for (const item of sdk.store.getItems()) {
        sdk.store.clearItemTimer(item.id);
      }
      sessionStorage.removeItem('memizy.plugin-sdk.standalone.v0.3');
      location.reload();
    } catch (err) {
      await sdk.sys.reportError('reset-failed', String(err));
    }
  });

  $<HTMLButtonElement>('#end-btn').addEventListener('click', async () => {
    const progress = sdk.store.getProgress();
    const total = Object.keys(progress).length;
    const correct = Object.values(progress).filter((p) => p.bucket > 1).length;
    const score = total === 0 ? 0 : Math.round((correct / total) * 100);
    await sdk.sys.exit({ score });
    toast(`Session ended. Score: ${score}`, 'ok');
  });
}

// -- Rendering --------------------------------------------------------------

function currentItem(): OQSEItem | undefined {
  return sdk.store.getItems()[currentIndex];
}

function renderAll(): void {
  renderItem();
  renderStats();
  renderBucketBar();
}

function renderItem(): void {
  const items = sdk.store.getItems();
  const item = items[currentIndex];

  const metaEl = $<HTMLDivElement>('#item-meta');
  metaEl.textContent = item
    ? `${item.type} · ${currentIndex + 1} / ${items.length}`
    : 'No items loaded';

  const prompt = $<HTMLDivElement>('#prompt');
  const reveal = $<HTMLDivElement>('#reveal');
  const choices = $<HTMLDivElement>('#choices');
  const flipBtn = $<HTMLButtonElement>('#flip-btn');
  const answerGrp = $<HTMLDivElement>('#answer-group');

  prompt.innerHTML = '';
  reveal.innerHTML = '';
  choices.innerHTML = '';
  reveal.classList.add('mz-hidden');
  choices.classList.add('mz-hidden');
  answerGrp.classList.add('mz-hidden');
  flipBtn.classList.remove('mz-hidden');
  flipBtn.disabled = false;
  flipBtn.textContent = 'Show answer';

  if (!item) {
    prompt.textContent = 'Nothing to study — load a set from the ⚙ menu.';
    stopTimer();
    return;
  }

  if (isFlashcard(item)) {
    prompt.innerHTML = sdk.text.renderHtml(item.front);
    reveal.innerHTML = sdk.text.renderHtml(item.back);
    // flipBtn + answerGrp are shown on flip()
  } else if (isMCQSingle(item)) {
    prompt.innerHTML = sdk.text.renderHtml(item.question);
    flipBtn.classList.add('mz-hidden');
    choices.classList.remove('mz-hidden');
    item.options.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'choice';
      btn.innerHTML = `<span class="bullet">${String.fromCharCode(65 + idx)}</span><span>${escapeHtml(opt)}</span>`;
      btn.addEventListener('click', () => handleMcqAnswer(item.id, idx, item.correctIndex, btn));
      choices.appendChild(btn);
    });
  } else {
    prompt.textContent = `(The example app doesn't render the "${item.type}" item type.)`;
  }

  startTimer(item.id);
}

function flip(): void {
  const item = currentItem();
  if (!item || !isFlashcard(item)) return;
  $('#reveal').classList.remove('mz-hidden');
  $<HTMLButtonElement>('#flip-btn').disabled = true;
  $('#answer-group').classList.remove('mz-hidden');
}

function handleMcqAnswer(
  itemId: string,
  choice: number,
  correct: number,
  btn: HTMLElement,
): void {
  const choices = $('#choices');
  [...choices.querySelectorAll<HTMLElement>('.choice')].forEach((c, idx) => {
    c.classList.remove('correct', 'incorrect');
    if (idx === correct) c.classList.add('correct');
    (c as HTMLButtonElement).disabled = true;
  });
  const isCorrect = choice === correct;
  if (!isCorrect) btn.classList.add('incorrect');

  const rec = sdk.store.answer(itemId, isCorrect, {
    confidence: isCorrect ? 3 : 1,
  });
  toast(isCorrect ? `Nice! Bucket → ${rec.bucket}` : 'Incorrect.', isCorrect ? 'ok' : 'error');

  window.setTimeout(advance, 900);
}

function advance(): void {
  const items = sdk.store.getItems();
  currentIndex = (currentIndex + 1) % Math.max(items.length, 1);
  renderAll();
}

// -- Sidebar: stats & bucket bar --------------------------------------------

function renderStats(): void {
  const item = currentItem();
  const progress = sdk.store.getProgress();
  const rec: ProgressRecord | undefined = item ? progress[item.id] : undefined;

  const bucket = rec?.bucket ?? 0;
  const streak = rec?.stats.streak ?? 0;
  const attempts = rec?.stats.attempts ?? 0;

  $<HTMLDivElement>('#stat-bucket').innerHTML = `<span class="b-dot b${bucket}"></span><span>${bucket}</span>`;
  $<HTMLDivElement>('#stat-streak').textContent = String(streak);
  $<HTMLDivElement>('#stat-attempts').textContent = String(attempts);

  const total = sdk.store.getItems().length;
  const known = Object.values(progress).filter((p) => p.bucket >= 2).length;
  $<HTMLSpanElement>('#session-meta').textContent =
    `${known}/${total} mastered · ${Object.keys(progress).length} seen`;
}

function renderBucketBar(): void {
  const track = $<HTMLDivElement>('#bucket-track');
  track.innerHTML = '';
  const items = sdk.store.getItems();
  const progress = sdk.store.getProgress();
  const total = items.length;
  if (total === 0) return;

  const buckets: Record<Bucket, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const item of items) {
    const b = progress[item.id]?.bucket ?? 0;
    buckets[b] += 1;
  }

  ([0, 1, 2, 3, 4] as const).forEach((b) => {
    const count = buckets[b];
    if (count === 0) return;
    const seg = document.createElement('div');
    seg.className = `bucket-seg s${b}`;
    seg.style.width = `${(count / total) * 100}%`;
    seg.title = `Bucket ${b}: ${count} item(s)`;
    track.appendChild(seg);
  });
}

// -- Timer ------------------------------------------------------------------

function startTimer(itemId: string): void {
  stopTimer();
  sdk.store.startItemTimer(itemId);
  const started = Date.now();
  const el = $<HTMLDivElement>('#timer');
  const tick = () => {
    const sec = Math.floor((Date.now() - started) / 1000);
    const mm = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    el.textContent = `${mm}:${ss}`;
  };
  tick();
  timerHandle = window.setInterval(tick, 1000);
}

function stopTimer(): void {
  if (timerHandle !== null) {
    window.clearInterval(timerHandle);
    timerHandle = null;
  }
}

// -- Util -------------------------------------------------------------------

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
