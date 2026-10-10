import { describe, expect, it } from 'vitest';
import { replaceAssetsFallback } from '../vite-plugin-excalidraw-local-assets';

describe('replaceAssetsFallback', () => {
  const minified =
    'var x=1;P(jn,"ASSETS_FALLBACK_URL",`https://esm.sh/${M.PKG_NAME?`${M.PKG_NAME}@${M.PKG_VERSION}`:"@excalidraw/excalidraw"}/dist/prod/`);var Xo=jn;';

  it('points the fallback at the folder of the chunk', () => {
    const out = replaceAssetsFallback(minified);

    expect(out).toBe(
      'var x=1;P(jn,"ASSETS_FALLBACK_URL",import.meta.url.replace(/[^/]*$/,""));var Xo=jn;',
    );
    expect(out).not.toContain('esm.sh');
  });

  it('gives null for code without the definition', () => {
    expect(replaceAssetsFallback('const a = 1;')).toBeNull();
  });
});
