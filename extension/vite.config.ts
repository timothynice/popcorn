import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { renameSync, mkdirSync, existsSync, copyFileSync, readdirSync } from 'fs';

/**
 * Chrome extension Vite build config.
 *
 * Background service worker: ES module (manifest declares "type": "module")
 * Content script: Single self-contained file
 * Popup: Standard React HTML entry
 *
 * We use ES format. Background uses "type": "module" in manifest.
 * Content script is tree-shaken into a single file with no dynamic imports.
 */

/**
 * Post-build plugin that:
 * 1. Moves popup HTML from dist/src/popup/ to dist/popup/ (Vite
 *    preserves the source directory structure for HTML entries).
 * 2. Copies manifest.json into dist/ so the extension can be loaded
 *    directly from the dist folder via chrome://extensions.
 */
function chromeExtensionPlugin(): Plugin {
  return {
    name: 'chrome-extension-fixup',
    closeBundle() {
      const distDir = resolve(__dirname, 'dist');
      const popupDir = resolve(distDir, 'popup');
      const srcPopupDir = resolve(distDir, 'src', 'popup');

      // Move popup HTML from dist/src/popup/ to dist/popup/
      if (existsSync(resolve(srcPopupDir, 'index.html'))) {
        if (!existsSync(popupDir)) {
          mkdirSync(popupDir, { recursive: true });
        }
        renameSync(
          resolve(srcPopupDir, 'index.html'),
          resolve(popupDir, 'index.html'),
        );
      }

      // Copy manifest.json into dist/
      const manifestSrc = resolve(__dirname, 'manifest.json');
      if (existsSync(manifestSrc)) {
        copyFileSync(manifestSrc, resolve(distDir, 'manifest.json'));
      }

      // Copy offscreen.html into dist/
      const offscreenSrc = resolve(__dirname, 'src', 'offscreen.html');
      if (existsSync(offscreenSrc)) {
        copyFileSync(offscreenSrc, resolve(distDir, 'offscreen.html'));
      }

      // Copy icons from assets/ into dist/assets/
      const assetsSrc = resolve(__dirname, 'assets');
      const assetsDist = resolve(distDir, 'assets');
      if (existsSync(assetsSrc)) {
        if (!existsSync(assetsDist)) {
          mkdirSync(assetsDist, { recursive: true });
        }
        for (const file of readdirSync(assetsSrc)) {
          copyFileSync(resolve(assetsSrc, file), resolve(assetsDist, file));
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), chromeExtensionPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/index.ts'),
        content: resolve(__dirname, 'src/content/index.ts'),
        'page-scanner': resolve(__dirname, 'src/content/page-scanner.ts'),
        offscreen: resolve(__dirname, 'src/capture/offscreen-recorder.ts'),
        popup: resolve(__dirname, 'src/popup/index.html'),
      },
      output: {
        format: 'es',
        entryFileNames: (chunkInfo) => {
          if (
            chunkInfo.name === 'background' ||
            chunkInfo.name === 'content' ||
            chunkInfo.name === 'page-scanner' ||
            chunkInfo.name === 'offscreen'
          ) {
            return `${chunkInfo.name}.js`;
          }
          return 'popup/[name].js';
        },
        chunkFileNames: 'popup/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) {
            return 'popup/[name][extname]';
          }
          return 'assets/[name][extname]';
        },
      },
    },
  },
  resolve: {
    alias: {
      '@popcorn/shared': resolve(__dirname, '../shared/src/index.ts'),
    },
  },
});
