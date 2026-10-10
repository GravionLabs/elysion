import type { Plugin } from 'vite';

/**
 * Excalidraw draws its line grid on the static canvas whenever its grid mode is on, and the grid mode is also what makes it
 * snap (the two cannot be separated through the API). The board shows dots of its own instead (`grid-dots.ts`), so the
 * call that tells the static canvas to draw the lines is switched off in the library's code: `renderGrid: isGridModeEnabled(this)`
 * in the development build, `renderGrid:gn(this)` once minified. Snapping is not touched.
 *
 * A library whose code no longer has the call fails the build instead of silently showing both grids again.
 */
const RENDER_GRID_CALL = /renderGrid:\s*[\w$]+\(this\)/;
const EXCALIDRAW_ENTRY = /@excalidraw\/excalidraw\/dist\/(?:dev|prod)\/index\.js$/;

export function replaceRenderGrid(code: string): string | null {
  return RENDER_GRID_CALL.test(code) ? code.replace(RENDER_GRID_CALL, 'renderGrid:false') : null; // one call site
}

function failMissing(id: string): never {
  throw new Error(
    `${id}: the call "renderGrid: ...(this)" is gone, so Excalidraw's line grid cannot be switched off any more. ` +
      'Update vite-plugin-excalidraw-no-grid.ts for the new library version.',
  );
}

/** For the bundler of a build and of the dev server's own module graph. */
export function excalidrawNoGridLines(): Plugin {
  return {
    name: 'excalidraw-no-grid-lines',
    enforce: 'pre',
    transform(code, id) {
      const path = id.split('?')[0];
      if (!EXCALIDRAW_ENTRY.test(path)) return null;
      const replaced = replaceRenderGrid(code);
      if (replaced === null) failMissing(path);
      return { code: replaced, map: null };
    },
    config() {
      // The dev server pre-bundles dependencies with esbuild, which does not run Vite plugins: do the same there.
      return {
        optimizeDeps: {
          esbuildOptions: {
            plugins: [
              {
                name: 'excalidraw-no-grid-lines',
                setup(build) {
                  build.onLoad({ filter: EXCALIDRAW_ENTRY }, async (args) => {
                    const { readFile } = await import('node:fs/promises');
                    const replaced = replaceRenderGrid(await readFile(args.path, 'utf8'));
                    if (replaced === null) failMissing(args.path);
                    return { contents: replaced, loader: 'js' };
                  });
                },
              },
            ],
          },
        },
      };
    },
  };
}
