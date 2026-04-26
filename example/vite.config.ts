import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pkg from '../package.json';

const here = dirname(fileURLToPath(import.meta.url));
const sdkRoot = resolve(here, '..');

/**
 * Vite config for the example plugin.
 *
 * Serves / builds the standalone demo that lives in `example/`. The
 * `@memizy/plugin-sdk` alias points straight at the source so changes
 * show up live without rebuilding the library.
 *
 * GitHub Pages deploys the `dist/` output of this config under a
 * subpath matching the repo name (`/plugin-sdk/`), so we honour the
 * `--base` CLI flag.
 */
export default defineConfig({
  root: here,
  define: {
    __SDK_VERSION__: JSON.stringify(pkg.version),
  },
  // Dev server + `example:build` both use relative paths so the bundle
  // works from any subdirectory. The GH-Pages build overrides this via
  // `--base=/plugin-sdk/` in the `example:build:pages` script.
  base: './',
  resolve: {
    alias: {
      '@memizy/plugin-sdk': resolve(sdkRoot, 'src/index.ts'),
    },
  },
  build: {
    outDir: resolve(here, 'dist'),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        main:    resolve(here, 'index.html'),
        minimal: resolve(here, 'minimal.html'),
      },
    },
  },
  server: {
    port: 5173,
    open: true,
  },
});
