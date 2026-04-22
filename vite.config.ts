import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Root Vite config — **library build only**.
 *
 * The example app has its own config at `example/vite.config.ts`; use
 * `npm run example:dev` / `npm run example:build` to work with it.
 */
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'MemizySDK',
      fileName: 'memizy-sdk',
      formats: ['es', 'umd'],
    },
    rollupOptions: {
      external: ['@memizy/oqse', 'penpal', 'mutative'],
      output: {
        globals: {
          '@memizy/oqse': 'MemizyOqse',
          penpal: 'Penpal',
          mutative: 'Mutative',
        },
      },
    },
    sourcemap: true,
  },
});
