import type { Plugin } from 'vite';

/**
 * Excalidraw loads its fonts from `EXCALIDRAW_ASSET_PATH` and, after that, from a fallback it hard-codes: its own
 * package on https://esm.sh. A page whose Content-Security-Policy does not allow that third party gets a violation for
 * every font file, and the request fails offline and in a closed network. The element bundle ships the fonts next to
 * itself (`vite.element.config.ts`, `dist-element/fonts`), so the fallback becomes the folder the library's chunk was
 * loaded from (a string operation: Vite turns `new URL('./', import.meta.url)` into an inlined asset): in the minified build `P(X,"ASSETS_FALLBACK_URL",`https://esm.sh/…/dist/prod/`)`.
 *
 * A library whose code no longer has that definition fails the build instead of silently going back to the CDN.
 */
// The template literal holds one of its own (`${…?`…`:…}`), so it is read up to the path it ends with.
const FALLBACK = /"ASSETS_FALLBACK_URL",`https:\/\/esm\.sh\/[\s\S]*?\/dist\/prod\/`\)/;
const EXCALIDRAW_CHUNK = /@excalidraw\/excalidraw\/dist\/prod\/[^/]+\.js$/;

export function replaceAssetsFallback(code: string): string | null {
  return FALLBACK.test(code)
    ? code.replace(FALLBACK, '"ASSETS_FALLBACK_URL",import.meta.url.replace(/[^/]*$/,""))')
    : null;
}

export function excalidrawLocalAssets(): Plugin {
  return {
    name: 'excalidraw-local-assets',
    enforce: 'pre',
    transform(code, id) {
      const path = id.split('?')[0];
      if (!EXCALIDRAW_CHUNK.test(path) || !code.includes('ASSETS_FALLBACK_URL')) return null;
      const replaced = replaceAssetsFallback(code);
      if (replaced === null) {
        throw new Error(
          `${path}: the definition of ASSETS_FALLBACK_URL changed, so Excalidraw's fonts would come from the CDN again. ` +
            'Update vite-plugin-excalidraw-local-assets.ts for the new library version.',
        );
      }
      return { code: replaced, map: null };
    },
  };
}
