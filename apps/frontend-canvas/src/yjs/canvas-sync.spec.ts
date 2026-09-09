import { convertToExcalidrawElements, restoreAppState } from '@excalidraw/excalidraw';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { WebSocket as NodeWebSocketClient } from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExcalidrawYjsBinding } from './excalidraw-binding.js';
import { startTestYjsServer, waitUntil, type TestYjsServer } from './test-yjs-server.js';
import { YjsWebsocketClient } from './YjsWebsocketClient.js';

const WebSocketImpl = NodeWebSocketClient as unknown as typeof WebSocket;

function createMockApi() {
  let elements: readonly OrderedExcalidrawElement[] = [];
  const updateScene = vi.fn((sceneData: { elements?: readonly OrderedExcalidrawElement[] }) => {
    if (sceneData.elements) {
      elements = sceneData.elements;
    }
  });
  const api = {
    getSceneElementsIncludingDeleted: () => elements,
    getAppState: () => restoreAppState(null, null),
    updateScene,
  } as unknown as ExcalidrawImperativeAPI;
  return { api, getElements: () => elements };
}

/** One (client + binding + mock api) triple, wired exactly like CanvasApp does. */
function createCanvasPeer(url: string) {
  const client = new YjsWebsocketClient(url, undefined, { WebSocketImpl });
  const binding = new ExcalidrawYjsBinding(client.doc);
  const { api, getElements } = createMockApi();
  binding.attach(api);
  return {
    binding,
    getElements,
    draw: (element: OrderedExcalidrawElement) => binding.onLocalChange([element]),
    destroy: () => {
      binding.destroy();
      client.destroy();
    },
  };
}

describe('canvas Yjs sync (two CanvasApp-style peers)', () => {
  let server: TestYjsServer;

  beforeEach(async () => {
    server = await startTestYjsServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('converges two peers on the same board after either draws an element', async () => {
    const url = `${server.url}?board=${crypto.randomUUID()}`;
    const peerA = createCanvasPeer(url);
    const peerB = createCanvasPeer(url);

    const [rect] = convertToExcalidrawElements([{ type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }]);
    peerA.draw(rect);

    await waitUntil(() => peerB.getElements().some((element) => element.id === rect.id));
    expect(peerB.getElements().map((element) => element.id)).toContain(rect.id);

    peerA.destroy();
    peerB.destroy();
  });

  it('sends a newly-joining peer the board state that already exists', async () => {
    const url = `${server.url}?board=${crypto.randomUUID()}`;
    const peerA = createCanvasPeer(url);
    const [rect] = convertToExcalidrawElements([{ type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }]);
    peerA.draw(rect);

    // Give the server time to actually receive and store it before the
    // second peer connects — this is what distinguishes "initial sync of
    // existing history" from "live update broadcast", which is a
    // different code path (YjsWebsocketClient didn't send its own
    // sync-step-1 on connect, so a late joiner never asked the server for
    // what it already had).
    await new Promise((resolve) => setTimeout(resolve, 100));

    const peerB = createCanvasPeer(url);
    await waitUntil(() => peerB.getElements().some((element) => element.id === rect.id));
    expect(peerB.getElements().map((element) => element.id)).toContain(rect.id);

    peerA.destroy();
    peerB.destroy();
  });

  it('propagates a later in-place mutation of the same element object, not just its first snapshot', async () => {
    const url = `${server.url}?board=${crypto.randomUUID()}`;
    const peerA = createCanvasPeer(url);
    const peerB = createCanvasPeer(url);

    // Excalidraw mutates its element objects in place rather than creating
    // a new object per change; draw() must still capture each version
    // independently rather than aliasing the same mutable reference.
    const [rect] = convertToExcalidrawElements([{ type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }]);
    peerA.draw(rect);
    await waitUntil(() => peerB.getElements().some((element) => element.id === rect.id));

    Object.assign(rect, { width: 999, version: rect.version + 1 });
    peerA.draw(rect);

    await waitUntil(() => peerB.getElements().find((element) => element.id === rect.id)?.width === 999);
    expect(peerB.getElements().find((element) => element.id === rect.id)?.width).toBe(999);

    peerA.destroy();
    peerB.destroy();
  });

  it('keeps peers on different boards independent', async () => {
    const peerA = createCanvasPeer(`${server.url}?board=${crypto.randomUUID()}`);
    const peerB = createCanvasPeer(`${server.url}?board=${crypto.randomUUID()}`);

    const [rect] = convertToExcalidrawElements([{ type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }]);
    peerA.draw(rect);
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(peerB.getElements().map((element) => element.id)).not.toContain(rect.id);

    peerA.destroy();
    peerB.destroy();
  });
});
