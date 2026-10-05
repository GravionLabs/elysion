import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.spec.{ts,tsx}'],
    setupFiles: ['src/test-setup.ts'],
    server: {
      deps: {
        // @excalidraw/excalidraw is otherwise treated as an external CJS/ESM
        // dep and executed directly by Node, which then hits its own nested
        // `import ... from "open-color"` (a bare specifier whose package
        // "main" is a plain .json file, no import attribute) — Node's
        // native loader rejects that. Inlining forces the whole graph
        // through Vite's transform instead, which handles JSON imports.
        // svg2pdf.js is inlined for another reason: Node would take its UMD build, which looks for
        // a global `jspdf` and fails; Vite's transform takes the ES build.
        inline: [/@excalidraw\/excalidraw/, 'open-color', 'svg2pdf.js'],
      },
    },
  },
});
