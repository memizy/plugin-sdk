import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ command }) => {
  if (command === 'build') {
    // Library build — generates ES + UMD bundles in dist/
    return {
      build: {
        lib: {
          entry: resolve(__dirname, 'src/index.ts'),
          name: 'MemizySDK',
          fileName: 'memizy-sdk',
          formats: ['es', 'umd'],
        },
      },
    };
  }

  // Dev server — serves playground/ at /
  return {
    root: './playground',
    resolve: {
      alias: {
        '@memizy/plugin-sdk': resolve(__dirname, 'src/index.ts'),
      },
    },
  };
});
