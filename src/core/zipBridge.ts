/**
 * zipBridge.ts — zero-dependency lazy-loaded `.oqse` ZIP archive support.
 *
 * JSZip is imported dynamically from CDN at runtime so it never inflates the
 * npm bundle. Both functions are only ever called in Standalone Mode.
 */

import type { OQSEItem, OQSEMeta } from '../types/oqse';
import type { StandaloneStorage } from './storage';

// ── Minimal local typings for JSZip (avoids installing @types/jszip) ────────

interface JSZipFile {
  name: string;
  dir:  boolean;
  async(type: 'arraybuffer'): Promise<ArrayBuffer>;
  async(type: 'text'):        Promise<string>;
}
interface JSZipInstance {
  loadAsync(data: ArrayBuffer | Uint8Array | Blob): Promise<JSZipInstance>;
  files: Record<string, JSZipFile>;
  folder(name: string): JSZipInstance;
  file(name: string): JSZipFile | null;
  file(name: string, data: string | Blob | ArrayBuffer | Uint8Array): JSZipInstance;
  generateAsync(options: { type: 'blob' }): Promise<Blob>;
}
interface JSZipConstructor {
  new(): JSZipInstance;
}

// ── CDN loader ───────────────────────────────────────────────────────────────

async function loadJSZip(): Promise<JSZipConstructor> {
  // Dynamic CDN import — intentionally not installed as a dev dependency.
  // @vite-ignore suppresses Vite's warning; @ts-ignore suppresses tsc's
  // inability to resolve URL-based module specifiers.
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const mod = await import(/* @vite-ignore */ 'https://esm.sh/jszip@3.10.1') as { default?: JSZipConstructor };
  return (mod.default ?? (mod as unknown as JSZipConstructor));
}

// ── Import ───────────────────────────────────────────────────────────────────

/**
 * Parse a `.oqse` ZIP archive and persist its contents to `StandaloneStorage`.
 *
 * Expected ZIP layout:
 * ```
 * data.json          — { items: OQSEItem[], meta: OQSEMeta }
 * assets/            — binary files referenced by items/meta as "assets/<name>"
 * ```
 *
 * After a successful import, call `location.reload()` so that
 * `maybeInitStandaloneMode` auto-restores the session from IndexedDB.
 */
export async function importOqseArchive(
  file: File,
  storage: StandaloneStorage,
): Promise<void> {
  const JSZip   = await loadJSZip();
  const zip     = await new JSZip().loadAsync(file);

  // ── Parse data.json ──────────────────────────────────────────────────────
  const dataFile = zip.file('data.json');
  if (!dataFile) throw new Error('.oqse archive is missing "data.json".');

  const raw  = await dataFile.async('text');
  const data = JSON.parse(raw) as Record<string, unknown>;

  const items = (data['items'] as OQSEItem[] | undefined) ?? [];
  if (!Array.isArray(items)) throw new Error('"data.json" must contain an "items" array.');
  const meta  = (data['meta'] as OQSEMeta | undefined) ?? {} as OQSEMeta;

  // ── Persist set data ─────────────────────────────────────────────────────
  // Clear existing items first, then save fresh batch
  await storage.deleteItems(items.map(it => it['id'] as string)); // pre-clear (no-op if empty)
  await storage.saveItems(items);
  await storage.updateMeta(meta);

  // ── Persist assets ───────────────────────────────────────────────────────
  const assetEntries = Object.entries(zip.files).filter(
    ([name, f]) => name.startsWith('assets/') && !f.dir,
  );
  await Promise.all(
    assetEntries.map(async ([name, f]) => {
      const buf  = await f.async('arraybuffer');
      const blob = new Blob([buf]);
      await storage.saveAsset(name, blob);
    }),
  );
}

// ── Export ───────────────────────────────────────────────────────────────────

/**
 * Build and download an `.oqse` ZIP archive from the current `StandaloneStorage`
 * contents.
 *
 * ZIP layout matches the import format:
 * ```
 * data.json
 * assets/<key>   — one file per stored asset
 * ```
 */
export async function exportOqseArchive(storage: StandaloneStorage): Promise<void> {
  const JSZip = await loadJSZip();
  const zip   = new JSZip();

  // ── data.json ─────────────────────────────────────────────────────────────
  const saved = await storage.getSet();
  const items = saved?.items ?? [];
  const meta  = saved?.meta  ?? {};
  zip.file('data.json', JSON.stringify({ items, meta }, null, 2));

  // ── assets/ ───────────────────────────────────────────────────────────────
  const allAssets = await storage.getAllAssets();
  for (const [key, blob] of Object.entries(allAssets)) {
    // Assets are stored with paths like "assets/foo.png" — add them verbatim
    zip.file(key, blob);
  }

  // ── Generate and trigger download ─────────────────────────────────────────
  const blob    = await zip.generateAsync({ type: 'blob' });
  const url     = URL.createObjectURL(blob);
  const anchor  = document.createElement('a');
  anchor.href   = url;
  anchor.download = 'export.oqse';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
