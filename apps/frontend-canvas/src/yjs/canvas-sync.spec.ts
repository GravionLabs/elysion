import { convertToExcalidrawElements, restoreAppState } from '@excalidraw/excalidraw';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { WebSocket as NodeWebSocketClient } from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExcalidrawYjsBinding } from './excalidraw-binding.js';
import { startTestYjsServer, waitUntil, type TestYjsServer } from './test-yjs-server.js';
import { YjsWebsocketClient } from './YjsWebsocketClient.js';
import { STICKY_COLORS, createStickyNote } from '../sticky-note.js';

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
  return {
    api,
    getElements: () => elements,
    setElements: (next: readonly OrderedExcalidrawElement[]) => {
      elements = next;
    },
  };
}

/** One (client + binding + mock api) triple, wired exactly like CanvasApp does. */
function createCanvasPeer(url: string) {
  const client = new YjsWebsocketClient(url, undefined, { WebSocketImpl });
  const binding = new ExcalidrawYjsBinding(client.doc);
  const { api, getElements, setElements } = createMockApi();
  binding.attach(api);
  return {
    binding,
    getElements,
    setElements,
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

    const [rect] = convertToExcalidrawElements([
      { type: 'rectangle', x: 0, y: 0, width: 10, height: 10 },
    ]);
    peerA.draw(rect);

    await waitUntil(() => peerB.getElements().some((element) => element.id === rect.id));
    expect(peerB.getElements().map((element) => element.id)).toContain(rect.id);

    peerA.destroy();
    peerB.destroy();
  });

  it('syncs a sticky note (container plus bound text) with its style intact', async () => {
    const url = `${server.url}?board=${crypto.randomUUID()}`;
    const peerA = createCanvasPeer(url);
    const peerB = createCanvasPeer(url);

    const [card, label] = createStickyNote(STICKY_COLORS[3], { x: 0, y: 0 });
    peerA.binding.onLocalChange([card, label] as unknown as OrderedExcalidrawElement[]);

    await waitUntil(() => peerB.getElements().some((element) => element.id === label.id));
    const synced = peerB.getElements().find((element) => element.id === card.id);
    expect(synced).toMatchObject({
      roughness: 0,
      fillStyle: 'solid',
      strokeColor: card.strokeColor,
      backgroundColor: card.backgroundColor,
    });

    peerA.destroy();
    peerB.destroy();
  });

  it('propagates a later move of an already-synced element in both directions', async () => {
    const url = `${server.url}?board=${crypto.randomUUID()}`;
    const peerA = createCanvasPeer(url);
    const peerB = createCanvasPeer(url);

    // Excalidraw edits scene elements in place (bumping version/versionNonce)
    // and then reports the whole scene through onChange.
    const move = (peer: ReturnType<typeof createCanvasPeer>, id: string, x: number) => {
      const element = peer.getElements().find((candidate) => candidate.id === id)!;
      Object.assign(element, {
        x,
        version: element.version + 1,
        versionNonce: Math.random() * 1e9,
      });
      peer.binding.onLocalChange(peer.getElements());
    };
    const xOn = (peer: ReturnType<typeof createCanvasPeer>, id: string) =>
      peer.getElements().find((candidate) => candidate.id === id)?.x;

    const [rect] = convertToExcalidrawElements([
      { type: 'rectangle', x: 0, y: 0, width: 10, height: 10 },
    ]);
    peerA.setElements([rect as unknown as OrderedExcalidrawElement]);
    peerA.binding.onLocalChange(peerA.getElements());
    await waitUntil(() => peerB.getElements().some((element) => element.id === rect.id));

    move(peerA, rect.id, 100);
    await waitUntil(() => xOn(peerB, rect.id) === 100);

    move(peerB, rect.id, 200);
    await waitUntil(() => xOn(peerA, rect.id) === 200);

    move(peerA, rect.id, 300);
    await waitUntil(() => xOn(peerB, rect.id) === 300);

    peerA.destroy();
    peerB.destroy();
  });

  it('sends a newly-joining peer the board state that already exists', async () => {
    const url = `${server.url}?board=${crypto.randomUUID()}`;
    const peerA = createCanvasPeer(url);
    const [rect] = convertToExcalidrawElements([
      { type: 'rectangle', x: 0, y: 0, width: 10, height: 10 },
    ]);
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
    const [rect] = convertToExcalidrawElements([
      { type: 'rectangle', x: 0, y: 0, width: 10, height: 10 },
    ]);
    peerA.draw(rect);
    await waitUntil(() => peerB.getElements().some((element) => element.id === rect.id));

    Object.assign(rect, { width: 999, version: rect.version + 1 });
    peerA.draw(rect);

    await waitUntil(
      () => peerB.getElements().find((element) => element.id === rect.id)?.width === 999,
    );
    expect(peerB.getElements().find((element) => element.id === rect.id)?.width).toBe(999);

    peerA.destroy();
    peerB.destroy();
  });

  it('keeps peers on different boards independent', async () => {
    const peerA = createCanvasPeer(`${server.url}?board=${crypto.randomUUID()}`);
    const peerB = createCanvasPeer(`${server.url}?board=${crypto.randomUUID()}`);

    const [rect] = convertToExcalidrawElements([
      { type: 'rectangle', x: 0, y: 0, width: 10, height: 10 },
    ]);
    peerA.draw(rect);
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(peerB.getElements().map((element) => element.id)).not.toContain(rect.id);

    peerA.destroy();
    peerB.destroy();
  });
});
