import { cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { excalidrawNoGridLines } from './vite-plugin-excalidraw-no-grid';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';

const outDir = fileURLToPath(new URL('dist-element', import.meta.url));
const frontendCanvasDir = fileURLToPath(new URL('../frontend/public/canvas', import.meta.url));

// In watch mode (`build:element:watch`) every rebuild replaces apps/frontend/public/canvas, which the
// Angular dev server serves: otherwise the bundle is copied once at start and goes stale. One-off
// builds leave it alone, `apps/frontend`'s `prebuild` copies for those.
function copyToFrontendWhenWatching(): Plugin {
  return {
    name: 'copy-element-to-frontend',
    apply: 'build',
    writeBundle() {
      if (!this.meta.watchMode) return;
      rmSync(frontendCanvasDir, { recursive: true, force: true });
      cpSync(outDir, frontendCanvasDir, { recursive: true });
      console.log(`[copy-element-to-frontend] updated ${frontendCanvasDir}`);
    },
  };
}

// Library build producing a dependency-free bundle that registers the
// <elysion-canvas> custom element, including its own React runtime and CSS
// so any host page (Angular or otherwise) can load it with one <script
// type="module">. ES module output (not iife) so Excalidraw's optional,
// heavy features (mermaid/cytoscape/katex diagram import, image resizing)
// stay as separate lazy chunks instead of bloating the initial load — iife
// can't code-split, which previously pulled all of that into one ~8MB file.
export default defineConfig({
  plugins: [
    react(),
    excalidrawNoGridLines(),
    cssInjectedByJsPlugin(),
    copyToFrontendWhenWatching(),
  ],
  // React/ReactDOM's CJS entry points branch on `process.env.NODE_ENV` to
  // pick their dev/production build; in app builds Vite's dep pre-bundling
  // replaces that for free, but this standalone build doesn't go through
  // that step, so `process` is otherwise left as a bare, undefined global
  // at runtime.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir,
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(new URL('src/element.tsx', import.meta.url)),
      formats: ['es'],
      fileName: () => 'elysion-canvas.js',
    },
  },
});
