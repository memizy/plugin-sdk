import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ command }) => {
  if (command === 'build') {
    return {
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
    };
  }

  return {
    root: './playground',
    resolve: {
      alias: {
        '@memizy/plugin-sdk': resolve(__dirname, 'src/index.ts'),
      },
    },
  };
});
