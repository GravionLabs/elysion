// jsdom doesn't implement IndexedDB; tldraw persists boards to it.
import 'fake-indexeddb/auto';

// jsdom doesn't implement HTMLImageElement.decode(); tldraw calls it while
// preloading UI assets. Stub it so component tests can mount <Tldraw />.
if (!HTMLImageElement.prototype.decode) {
  HTMLImageElement.prototype.decode = function decode(): Promise<void> {
    return Promise.resolve();
  };
}
