// jsdom doesn't implement canvas 2D rendering contexts; Excalidraw draws its
// scene (and does canvas feature-detection at import time) via one.
import 'vitest-canvas-mock';

// Node's native WebSocket (undici) has a dispatchEvent/realm mismatch with
// jsdom's swapped-in Event/EventTarget globals that throws on close (a
// known undici+jsdom interop issue, not a bug in our code). Any component
// that opens a real WebSocket (e.g. CanvasApp's Yjs client) hits this on
// unmount; `ws`'s WebSocket class doesn't have the same issue.
import { WebSocket as NodeWebSocket } from 'ws';
globalThis.WebSocket = NodeWebSocket as unknown as typeof WebSocket;

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

// Excalidraw takes long to start when the machine is busy (the other workspaces' tests run in
// parallel); the default one second for findBy and waitFor was not enough then.
import { configure } from '@testing-library/react';
configure({ asyncUtilTimeout: 5000 });
