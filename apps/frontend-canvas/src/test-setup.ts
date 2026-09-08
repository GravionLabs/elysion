// jsdom doesn't implement canvas 2D rendering contexts; Excalidraw draws its
// scene (and does canvas feature-detection at import time) via one.
import 'vitest-canvas-mock';

// jsdom doesn't implement the Font Loading API; Excalidraw registers its
// bundled fonts with document.fonts on mount. Stub both so that succeeds
// as a no-op — we don't care about actual font rendering in tests.
class StubFontFace {
  constructor(
    public family: string,
    public source: string | ArrayBuffer,
  ) {}
  load(): Promise<StubFontFace> {
    return Promise.resolve(this);
  }
}
if (typeof globalThis.FontFace === 'undefined') {
  globalThis.FontFace = StubFontFace as unknown as typeof FontFace;
}
if (!document.fonts) {
  Object.defineProperty(document, 'fonts', {
    value: { add: () => {}, delete: () => {}, has: () => false, forEach: () => {} },
  });
}
