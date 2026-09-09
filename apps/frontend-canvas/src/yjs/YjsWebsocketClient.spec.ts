import * as Y from 'yjs';
import { WebSocket as NodeWebSocketClient } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestYjsServer, waitUntil, type TestYjsServer } from './test-yjs-server.js';
import { YjsWebsocketClient } from './YjsWebsocketClient.js';

const WebSocketImpl = NodeWebSocketClient as unknown as typeof WebSocket;

describe('YjsWebsocketClient', () => {
  let server: TestYjsServer;

  beforeEach(async () => {
    server = await startTestYjsServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('converges two clients after either applies an update', async () => {
    const clientA = new YjsWebsocketClient(server.url, new Y.Doc(), { WebSocketImpl });
    const clientB = new YjsWebsocketClient(server.url, new Y.Doc(), { WebSocketImpl });

    clientA.doc.getMap('board').set('hello', 'world');
    await waitUntil(() => clientB.doc.getMap('board').get('hello') === 'world');
    expect(clientB.doc.getMap('board').get('hello')).toBe('world');

    clientB.doc.getMap('board').set('from', 'b');
    await waitUntil(() => clientA.doc.getMap('board').get('from') === 'b');
    expect(clientA.doc.getMap('board').get('from')).toBe('b');

    clientA.destroy();
    clientB.destroy();
  });

  it('reports connection status transitions', async () => {
    const statuses: string[] = [];
    const client = new YjsWebsocketClient(server.url, new Y.Doc(), {
      onStatusChange: (status) => statuses.push(status),
      WebSocketImpl,
    });

    await waitUntil(() => statuses.includes('connected'));
    expect(statuses).toEqual(['connecting', 'connected']);

    client.destroy();
  });
});
