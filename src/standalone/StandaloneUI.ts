/**
 * StandaloneUI — floating gear button + tabbed modal for loading
 * OQSE / OQSEP data into the mock host during development.
 *
 * Mounted in a **closed** Shadow Root so plugin styles never leak in and
 * the UI's CSS can never leak into the plugin's DOM.
 */

import type { ProgressRecord } from '@memizy/oqse';
import { STANDALONE_UI_CSS } from './styles';

export type StandaloneUiPosition =
  | 'bottom-right'
  | 'bottom-left'
  | 'top-right'
  | 'top-left';

export interface StandaloneUICallbacks {
  /** Fetch and load an OQSE file from a URL. */
  loadSetFromUrl(url: string): Promise<void>;
  /** Parse and load raw OQSE JSON text. */
  loadSetFromText(text: string): Promise<void>;
  /** Read and load an OQSE file (`.json`). */
  loadSetFromFile(file: File): Promise<void>;
  /** Parse and load raw OQSEP progress JSON. */
  loadProgressFromText(text: string): Promise<void>;
  /** Read and load an OQSEP progress file (`.oqsep` / `.json`). */
  loadProgressFromFile(file: File): Promise<void>;
  /** Snapshot of already-loaded progress (used for the status pill). */
  getProgressCount(): number;
}

export interface StandaloneUIOptions {
  autoOpen: boolean;
  showGear: boolean;
  position: StandaloneUiPosition;
  callbacks: StandaloneUICallbacks;
}

/**
 * Manages the lifecycle of the Shadow-DOM UI. Construct once per SDK
 * connection; destroy on teardown.
 */
export class StandaloneUI {
  private readonly hostEl: HTMLElement;
  private readonly shadow: ShadowRoot;
  private readonly overlay: HTMLElement;
  private readonly gear: HTMLButtonElement | null;
  private readonly callbacks: StandaloneUICallbacks;
  private readonly escListener: (e: KeyboardEvent) => void;

  constructor(options: StandaloneUIOptions) {
    this.callbacks = options.callbacks;

    this.hostEl = document.createElement('div');
    this.hostEl.setAttribute('data-memizy-standalone-ui', '');
    // Use a closed root so plugin code cannot query into / manipulate our UI.
    this.shadow = this.hostEl.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = STANDALONE_UI_CSS;
    this.shadow.appendChild(style);

    this.gear = options.showGear ? this.buildGear(options.position) : null;
    if (this.gear) this.shadow.appendChild(this.gear);

    this.overlay = this.buildOverlay();
    this.overlay.classList.toggle('mz-hidden', !options.autoOpen);
    this.shadow.appendChild(this.overlay);

    document.body.appendChild(this.hostEl);

    this.wire();

    this.escListener = (e) => {
      if (e.key === 'Escape' && !this.overlay.classList.contains('mz-hidden')) {
        this.close();
      }
    };
    document.addEventListener('keydown', this.escListener);

    if (options.autoOpen) this.focusFirstInput();
  }

  /** Show the modal. */
  open(): void {
    this.overlay.classList.remove('mz-hidden');
    this.refreshProgressPill();
    this.focusFirstInput();
  }

  /** Hide the modal but keep the gear mounted (if enabled). */
  close(): void {
    this.overlay.classList.add('mz-hidden');
    this.clearStatus();
  }

  /** Completely remove the UI from the page. */
  destroy(): void {
    document.removeEventListener('keydown', this.escListener);
    this.hostEl.remove();
  }

  // ── DOM construction ────────────────────────────────────────────────────

  private buildGear(position: StandaloneUiPosition): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mz-gear';
    btn.dataset['pos'] = position;
    btn.setAttribute('aria-label', 'Open Memizy standalone controls');
    btn.title = 'Standalone controls';
    btn.textContent = '\u2699';
    return btn;
  }

  private buildOverlay(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'mz-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'mz-title');
    overlay.innerHTML = `
      <div class="mz-card">
        <div class="mz-header">
          <div class="mz-logo" aria-hidden="true">M</div>
          <div class="mz-title">
            <h2 id="mz-title">Memizy Standalone</h2>
            <p>Load an OQSE study set to start developing</p>
          </div>
          <button type="button" class="mz-close" data-action="close" aria-label="Close">&times;</button>
        </div>

        <div class="mz-tabs" role="tablist">
          <button type="button" class="mz-tab" role="tab" aria-selected="true"  data-tab="set">
            <span>Study Set</span>
          </button>
          <button type="button" class="mz-tab" role="tab" aria-selected="false" data-tab="progress">
            <span>Progress</span>
          </button>
        </div>

        <div class="mz-body">
          <!-- Study Set panel -->
          <div class="mz-panel" role="tabpanel" data-panel="set">
            <div class="mz-section">
              <label class="mz-label"><span class="mz-dot"></span>Load from URL</label>
              <div class="mz-row">
                <input type="url" class="mz-input" data-field="set-url"
                       placeholder="https://example.com/deck.oqse.json"
                       autocomplete="off" spellcheck="false" />
                <button type="button" class="mz-btn mz-btn-primary" data-action="load-url">
                  Load
                </button>
              </div>
            </div>

            <div class="mz-divider">or</div>

            <div class="mz-section">
              <label class="mz-label"><span class="mz-dot"></span>Paste OQSE JSON</label>
              <textarea class="mz-textarea" data-field="set-text"
                        placeholder='{ "version": "0.1", "meta": { ... }, "items": [ ... ] }'></textarea>
              <button type="button" class="mz-btn mz-btn-secondary mz-btn-full" data-action="load-text">
                Load from text
              </button>
            </div>

            <div class="mz-divider">or</div>

            <div class="mz-section">
              <label class="mz-label"><span class="mz-dot"></span>Upload file</label>
              <div class="mz-drop" data-drop="set" role="button" tabindex="0"
                   aria-label="Drop an OQSE file or click to browse">
                <div class="mz-drop-icon">&#x2191;</div>
                <div><strong>Drop</strong> an OQSE file here</div>
                <div>or click to browse (<code>.json</code>)</div>
                <input type="file" accept=".json,application/json" data-input="set-file" hidden />
              </div>
            </div>
          </div>

          <!-- Progress panel -->
          <div class="mz-panel mz-hidden" role="tabpanel" data-panel="progress">
            <div class="mz-section" data-progress-status></div>

            <div class="mz-section">
              <label class="mz-label"><span class="mz-dot"></span>Paste OQSEP JSON</label>
              <textarea class="mz-textarea" data-field="progress-text"
                        placeholder='{ "version": "0.1", "meta": { ... }, "records": { ... } }'></textarea>
              <button type="button" class="mz-btn mz-btn-secondary mz-btn-full" data-action="load-progress-text">
                Load progress from text
              </button>
            </div>

            <div class="mz-divider">or</div>

            <div class="mz-section">
              <label class="mz-label"><span class="mz-dot"></span>Upload file</label>
              <div class="mz-drop" data-drop="progress" role="button" tabindex="0"
                   aria-label="Drop an OQSEP progress file or click to browse">
                <div class="mz-drop-icon">&#x2191;</div>
                <div><strong>Drop</strong> a progress file here</div>
                <div>or click to browse (<code>.oqsep</code>, <code>.json</code>)</div>
                <input type="file" accept=".oqsep,.json,application/json" data-input="progress-file" hidden />
              </div>
            </div>
          </div>
        </div>

        <div class="mz-footer">
          <div class="mz-status" data-status></div>
          <div class="mz-hint">
            Tip: append <code>?set=&lt;url&gt;</code> to the page URL to auto-load a deck.
          </div>
        </div>
      </div>
    `;
    return overlay;
  }

  // ── Wiring ──────────────────────────────────────────────────────────────

  private wire(): void {
    const qs = <T extends Element>(sel: string) => this.shadow.querySelector<T>(sel)!;

    // Gear → toggle
    this.gear?.addEventListener('click', () => {
      if (this.overlay.classList.contains('mz-hidden')) this.open();
      else this.close();
    });

    // Close button + click-outside
    qs<HTMLButtonElement>('[data-action="close"]').addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });

    // Tabs
    const tabs = this.shadow.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    const panels = this.shadow.querySelectorAll<HTMLElement>('[role="tabpanel"]');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.setAttribute('aria-selected', 'false'));
        tab.setAttribute('aria-selected', 'true');
        const target = tab.dataset['tab']!;
        panels.forEach((p) => {
          p.classList.toggle('mz-hidden', p.dataset['panel'] !== target);
        });
        this.clearStatus();
        if (target === 'progress') this.refreshProgressPill();
      });
    });

    // ── Study Set actions ──
    const urlInput = qs<HTMLInputElement>('[data-field="set-url"]');
    const urlBtn = qs<HTMLButtonElement>('[data-action="load-url"]');
    const doLoadUrl = () => {
      const url = urlInput.value.trim();
      if (!url) return this.status('Please enter a URL.', 'error');
      this.runAsync(urlBtn, 'Load', () => this.callbacks.loadSetFromUrl(url), 'Set loaded.');
    };
    urlBtn.addEventListener('click', doLoadUrl);
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doLoadUrl();
      }
    });

    const setTextArea = qs<HTMLTextAreaElement>('[data-field="set-text"]');
    const setTextBtn = qs<HTMLButtonElement>('[data-action="load-text"]');
    setTextBtn.addEventListener('click', () => {
      const text = setTextArea.value.trim();
      if (!text) return this.status('Please paste OQSE JSON.', 'error');
      this.runAsync(
        setTextBtn,
        'Load from text',
        () => this.callbacks.loadSetFromText(text),
        'Set loaded.',
      );
    });

    this.wireDropZone('set', (file) =>
      this.runAsync(null, null, () => this.callbacks.loadSetFromFile(file), 'Set loaded.'),
    );

    // ── Progress actions ──
    const progTextArea = qs<HTMLTextAreaElement>('[data-field="progress-text"]');
    const progTextBtn = qs<HTMLButtonElement>('[data-action="load-progress-text"]');
    progTextBtn.addEventListener('click', () => {
      const text = progTextArea.value.trim();
      if (!text) return this.status('Please paste OQSEP JSON.', 'error');
      this.runAsync(
        progTextBtn,
        'Load progress from text',
        () => this.callbacks.loadProgressFromText(text),
        'Progress loaded.',
      ).then(() => this.refreshProgressPill());
    });

    this.wireDropZone('progress', (file) =>
      this.runAsync(null, null, () => this.callbacks.loadProgressFromFile(file), 'Progress loaded.')
        .then(() => this.refreshProgressPill()),
    );
  }

  private wireDropZone(
    name: 'set' | 'progress',
    onFile: (file: File) => void,
  ): void {
    const zone = this.shadow.querySelector<HTMLElement>(`[data-drop="${name}"]`)!;
    const input = this.shadow.querySelector<HTMLInputElement>(`[data-input="${name}-file"]`)!;

    const openPicker = () => input.click();
    zone.addEventListener('click', openPicker);
    zone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openPicker();
      }
    });
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) {
        onFile(file);
        input.value = '';
      }
    });
    ['dragenter', 'dragover'].forEach((evt) =>
      zone.addEventListener(evt, (e) => {
        e.preventDefault();
        zone.classList.add('mz-drag-over');
      }),
    );
    ['dragleave', 'dragend', 'drop'].forEach((evt) =>
      zone.addEventListener(evt, (e) => {
        if (evt === 'drop') e.preventDefault();
        zone.classList.remove('mz-drag-over');
      }),
    );
    zone.addEventListener('drop', (e) => {
      const file = (e as DragEvent).dataTransfer?.files[0];
      if (file) onFile(file);
    });
  }

  // ── Status / helpers ────────────────────────────────────────────────────

  private async runAsync(
    btn: HTMLButtonElement | null,
    originalLabel: string | null,
    task: () => Promise<void>,
    successMessage: string,
  ): Promise<void> {
    this.clearStatus();
    let previousHtml = '';
    if (btn) {
      previousHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<span class="mz-spinner" aria-hidden="true"></span><span>Loading\u2026</span>`;
    }
    try {
      await task();
      this.status(successMessage, 'ok');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.status(msg, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalLabel ? originalLabel : previousHtml;
      }
    }
  }

  private status(message: string, kind: 'error' | 'ok' | 'info'): void {
    const el = this.shadow.querySelector<HTMLElement>('[data-status]')!;
    el.textContent = message;
    el.className = `mz-status mz-status-${kind}`;
  }

  private clearStatus(): void {
    const el = this.shadow.querySelector<HTMLElement>('[data-status]');
    if (!el) return;
    el.textContent = '';
    el.className = 'mz-status';
  }

  private refreshProgressPill(): void {
    const host = this.shadow.querySelector<HTMLElement>('[data-progress-status]');
    if (!host) return;
    const count = this.callbacks.getProgressCount();
    host.innerHTML =
      count > 0
        ? `<div class="mz-ok-pill">${count} progress record${count === 1 ? '' : 's'} loaded</div>`
        : '';
  }

  private focusFirstInput(): void {
    requestAnimationFrame(() => {
      const input = this.shadow.querySelector<HTMLInputElement>('[data-field="set-url"]');
      input?.focus({ preventScroll: true });
    });
  }
}

// ---------------------------------------------------------------------------
// Re-exports used by callers of the UI
// ---------------------------------------------------------------------------

export type { ProgressRecord };
