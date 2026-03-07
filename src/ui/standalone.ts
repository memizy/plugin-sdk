/**
 * Standalone mode UI — floating gear button + tabbed settings dialog.
 * Injected into a closed Shadow DOM so plugin CSS never leaks in or out.
 */

import { STANDALONE_UI_CSS } from './styles';
import type { ProgressRecord } from '../types/oqsep';

export interface StandaloneUICallbacks {
  onLoadUrl:           (url:  string, onError: (msg: string) => void) => void;
  onLoadText:          (text: string, onError: (msg: string) => void) => void;
  onLoadFile:          (file: File,   onError: (msg: string) => void) => void;
  onLoadProgressText:  (text: string, onError: (msg: string) => void) => void;
  onLoadProgressFile:  (file: File,   onError: (msg: string) => void) => void;
  /** Return the currently stored standalone progress (for UI indicator). */
  getStandaloneProgress: () => Record<string, ProgressRecord> | null;
  /** Called when progress is loaded via the UI — stores it on the plugin. */
  setStandaloneProgress: (records: Record<string, ProgressRecord>) => void;
  /** Clear all persisted IndexedDB data and reload the page. */
  onReset: () => void;
  /** Import a full .oqse ZIP archive (saves to storage then reloads). */
  onLoadOqseArchive: (file: File, onError: (msg: string) => void) => void;
  /** Trigger .oqse ZIP export download. */
  onExportOqse: () => void;
  /** Trigger .oqsep progress JSON download. */
  onExportProgress: () => void;
}

/** Manages the Shadow DOM gear button + tabbed dialog in standalone mode. */
export class StandaloneUI {
  private readonly host: HTMLElement;
  private readonly overlay: HTMLElement;

  constructor(
    autoOpen: boolean,
    callbacks: StandaloneUICallbacks,
    position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' = 'bottom-right',
  ) {
    this.host = document.createElement('div');
    this.host.setAttribute('data-memizy-standalone', '');
    const shadow = this.host.attachShadow({ mode: 'closed' });

    // Styles
    const style = document.createElement('style');
    style.textContent = STANDALONE_UI_CSS;
    shadow.appendChild(style);

    // Gear button
    const gearBtn = document.createElement('button');
    gearBtn.className = 'gear-btn';
    gearBtn.textContent = '\u2699';
    gearBtn.title = 'Standalone settings';
    // Apply corner position
    const [vSide, hSide] = position.split('-') as ['bottom' | 'top', 'right' | 'left'];
    gearBtn.style[vSide]                                   = '16px';
    gearBtn.style[vSide === 'bottom' ? 'top'   : 'bottom'] = 'auto';
    gearBtn.style[hSide]                                   = '16px';
    gearBtn.style[hSide === 'right'  ? 'left'  : 'right']  = 'auto';
    shadow.appendChild(gearBtn);

    // Dialog overlay
    const overlay = document.createElement('div');
    overlay.className = autoOpen ? 'overlay' : 'overlay hidden';
    overlay.innerHTML = StandaloneUI.buildDialogHTML();
    shadow.appendChild(overlay);
    this.overlay = overlay;

    document.body.appendChild(this.host);

    // Wire up all event handlers
    this.wire(shadow, overlay, gearBtn, callbacks);

    if (autoOpen) {
      requestAnimationFrame(() => {
        const urlInput = shadow.getElementById('url-input') as HTMLInputElement | null;
        urlInput?.focus();
      });
    }
  }

  /** Hide the dialog but keep the gear button visible. */
  hide(): void {
    this.overlay.classList.add('hidden');
  }

  /** Remove the entire UI from the page. */
  destroy(): void {
    this.host.remove();
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private static buildDialogHTML(): string {
    return `
      <div class="card">
        <div class="header">
          <span class="logo">\ud83d\ude80</span>
          <h2>Memizy <span>Standalone</span></h2>
          <button class="close-btn" id="close-btn">\u00d7</button>
        </div>
        <div class="tabs">
          <button class="tab active" data-tab="set">Study Set</button>
          <button class="tab" data-tab="progress">Progress</button>
        </div>

        <div class="tab-body" id="tab-set">
          <div class="section">
            <label>Load from URL</label>
            <div class="row">
              <input type="url" id="url-input" placeholder="https://example.com/data.oqse.json" autocomplete="off" spellcheck="false" />
              <button class="btn btn-primary btn-sm" id="url-btn">Load</button>
            </div>
          </div>
          <div class="divider">or</div>
          <div class="section">
            <label>Paste OQSE JSON</label>
            <textarea id="set-json" rows="3" placeholder='{ "items": [ ... ] }'></textarea>
            <button class="btn btn-secondary btn-sm btn-full" id="set-json-btn" style="margin-top:8px">Load from text</button>
          </div>
          <div class="divider">or</div>
          <div class="section">
            <label>Upload file</label>
            <div class="drop-zone" id="set-drop">
              <span class="dz-icon">\ud83d\udcc1</span>
              Drop <code>.oqse.json</code> or <code>.oqse</code> here or click to browse
              <input type="file" id="set-file" accept=".json,.oqse" hidden />
            </div>
          </div>
        </div>

        <div class="tab-body hidden" id="tab-progress">
          <div id="progress-status"></div>
          <div class="section">
            <label>Paste OQSEP JSON</label>
            <textarea id="progress-json" rows="3" placeholder='{ "version": "0.1", "meta": { ... }, "records": { ... } }'></textarea>
            <button class="btn btn-secondary btn-sm btn-full" id="progress-json-btn" style="margin-top:8px">Load progress</button>
          </div>
          <div class="divider">or</div>
          <div class="section">
            <label>Upload file</label>
            <div class="drop-zone" id="progress-drop">
              <span class="dz-icon">\ud83d\udcc1</span>
              Drop <code>.oqsep</code> file here or click to browse
              <input type="file" id="progress-file" accept=".oqsep,.json" hidden />
            </div>
          </div>
        </div>

        <div class="status-bar" id="status-msg"></div>
        <div class="hint">Tip: append <code>?set=&lt;url&gt;</code> to the page URL to auto-load</div>
        <div class="export-bar">
          <button class="btn btn-export" id="export-oqse-btn">📥 Export Set (.oqse)</button>
          <button class="btn btn-export" id="export-progress-btn">📥 Export Progress (.oqsep)</button>
        </div>
        <div class="reset-bar">
          <button class="btn btn-reset" id="reset-btn">🗑️ Reset Local Data</button>
        </div>
      </div>
    `;
  }

  private wire(
    shadow: ShadowRoot,
    overlay: HTMLElement,
    gearBtn: HTMLButtonElement,
    cb: StandaloneUICallbacks,
  ): void {
    const $ = (id: string) => shadow.getElementById(id);
    const statusEl = $('status-msg')!;

    const setStatus = (msg: string, cls: string) => {
      statusEl.textContent = msg;
      statusEl.className = `status-bar ${cls}`;
    };
    const clearStatus = () => {
      statusEl.textContent = '';
      statusEl.className = 'status-bar';
    };

    const updateProgressIndicator = () => {
      const el = $('progress-status');
      if (!el) return;
      const prog = cb.getStandaloneProgress();
      if (prog) {
        const n = Object.keys(prog).length;
        el.innerHTML = `<div class="progress-ok">\u2705 ${n} progress record${n !== 1 ? 's' : ''} loaded</div>`;
      } else {
        el.innerHTML = '';
      }
    };

    // ── Export ──
    $('export-oqse-btn')!.addEventListener('click', () => cb.onExportOqse());
    $('export-progress-btn')!.addEventListener('click', () => cb.onExportProgress());

    // ── Reset ──
    $('reset-btn')!.addEventListener('click', () => {
      if (confirm('Clear all locally saved set data, progress and assets? This cannot be undone.')) {
        cb.onReset();
      }
    });

    // ── Open / close ──
    gearBtn.addEventListener('click', () => overlay.classList.toggle('hidden'));
    $('close-btn')!.addEventListener('click', () => overlay.classList.add('hidden'));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });

    // ── Tab switching ──
    const tabs = shadow.querySelectorAll('.tab') as NodeListOf<HTMLElement>;
    const tabBodies: Record<string, HTMLElement> = {
      set:      $('tab-set')!,
      progress: $('tab-progress')!,
    };
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset['tab']!;
        Object.values(tabBodies).forEach(b => b.classList.add('hidden'));
        tabBodies[target]?.classList.remove('hidden');
        clearStatus();
      });
    });

    // ── Study Set: URL ──
    const urlInput = $('url-input') as HTMLInputElement;
    const urlBtn   = $('url-btn')   as HTMLButtonElement;
    const loadFromUrl = () => {
      const url = urlInput.value.trim();
      if (!url) { setStatus('Please enter a URL.', 's-error'); return; }
      clearStatus();
      urlBtn.disabled = true;
      urlBtn.textContent = '\u2026';
      cb.onLoadUrl(url, (msg) => {
        setStatus('\u274c ' + msg, 's-error');
        urlBtn.disabled = false;
        urlBtn.textContent = 'Load';
      });
    };
    urlBtn.addEventListener('click', loadFromUrl);
    urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadFromUrl(); });

    // ── Study Set: Paste JSON ──
    const setJsonArea = $('set-json') as HTMLTextAreaElement;
    $('set-json-btn')!.addEventListener('click', () => {
      const text = setJsonArea.value.trim();
      if (!text) { setStatus('Please paste JSON content.', 's-error'); return; }
      clearStatus();
      cb.onLoadText(text, (msg) => setStatus('\u274c ' + msg, 's-error'));
    });

    // ── Study Set: File ──
    const setFileInput = $('set-file') as HTMLInputElement;
    const setDrop      = $('set-drop')!;
    const handleSetFile = (file: File) => {
      clearStatus();
      if (file.name.endsWith('.oqse')) {
        cb.onLoadOqseArchive(file, (msg) => setStatus('\u274c ' + msg, 's-error'));
      } else {
        cb.onLoadFile(file, (msg) => setStatus('\u274c ' + msg, 's-error'));
      }
    };
    setDrop.addEventListener('click', () => setFileInput.click());
    setFileInput.addEventListener('change', () => {
      const file = setFileInput.files?.[0];
      if (file) handleSetFile(file);
    });
    StandaloneUI.wireDrop(setDrop, handleSetFile);

    // ── Progress: Paste JSON ──
    const progressJsonArea = $('progress-json') as HTMLTextAreaElement;
    $('progress-json-btn')!.addEventListener('click', () => {
      const text = progressJsonArea.value.trim();
      if (!text) { setStatus('Please paste OQSEP JSON.', 's-error'); return; }
      cb.onLoadProgressText(text, (msg) => setStatus('\u274c ' + msg, 's-error'));
      updateProgressIndicator();
    });

    // ── Progress: File ──
    const progressFileInput = $('progress-file') as HTMLInputElement;
    const progressDrop      = $('progress-drop')!;
    progressDrop.addEventListener('click', () => progressFileInput.click());
    progressFileInput.addEventListener('change', () => {
      const file = progressFileInput.files?.[0];
      if (file) cb.onLoadProgressFile(file, (msg) => setStatus('\u274c ' + msg, 's-error'));
    });
    StandaloneUI.wireDrop(progressDrop, (file) => {
      cb.onLoadProgressFile(file, (msg) => setStatus('\u274c ' + msg, 's-error'));
    });
  }

  private static wireDrop(zone: HTMLElement, onFile: (f: File) => void): void {
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e: Event) => {
      const de = e as DragEvent;
      de.preventDefault();
      zone.classList.remove('drag-over');
      const file = de.dataTransfer?.files[0];
      if (file) onFile(file);
    });
  }
}
