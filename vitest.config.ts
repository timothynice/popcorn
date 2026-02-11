import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

const __dirname = new URL('.', import.meta.url).pathname;

export default defineConfig({
  test: {
    globals: true,
    include: [
      'shared/**/*.test.ts',
      'hook/**/*.test.ts',
      'extension/**/*.test.ts',
      'extension/**/*.test.tsx',
    ],
    environmentMatchGlobs: [
      ['extension/**', 'jsdom'],
      ['shared/**', 'node'],
      ['hook/**', 'node'],
    ],
    setupFiles: ['./extension/vitest.setup.ts'],
  },
  resolve: {
    alias: {
      '@popcorn/shared': resolve(__dirname, './shared/src/index.ts'),
    },
  },
});
