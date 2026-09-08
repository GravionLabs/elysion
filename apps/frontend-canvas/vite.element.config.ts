import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';

// Library build producing a single, dependency-free bundle that registers
// the <elysion-canvas> custom element, including its own React runtime and
// CSS so any host page (Angular or otherwise) can load it with one <script>.
export default defineConfig({
  plugins: [react(), cssInjectedByJsPlugin()],
  // React/ReactDOM's CJS entry points branch on `process.env.NODE_ENV` to
  // pick their dev/production build; in app builds Vite's dep pre-bundling
  // replaces that for free, but this standalone iife build doesn't go
  // through that step, so `process` is otherwise left as a bare, undefined
  // global at runtime.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'dist-element',
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(new URL('src/element.tsx', import.meta.url)),
      name: 'ElysionCanvas',
      formats: ['iife'],
      fileName: () => 'elysion-canvas.js',
    },
  },
});
