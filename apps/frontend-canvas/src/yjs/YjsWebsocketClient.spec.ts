import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { WebSocket as NodeWebSocketClient, WebSocketServer, type WebSocket as NodeWebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MESSAGE_SYNC } from './protocol.js';
import { YjsWebsocketClient } from './YjsWebsocketClient.js';

/**
 * A minimal stand-in for apps/realtime's YjsGateway — enough of the same
 * sync sub-protocol to prove YjsWebsocketClient behaves correctly against
 * any correct server, independent of the real backend (which has its own
 * e2e test covering the server side).
 */
function startTestServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const doc = new Y.Doc();
  const clients = new Set<NodeWebSocket>();
  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer });

  doc.on('update', (update: Uint8Array, origin: unknown) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);
    for (const client of clients) {
      if (client !== origin && client.readyState === client.OPEN) {
        client.send(message);
      }
    }
  });

  wss.on('connection', (client) => {
    clients.add(client);

    const step1 = encoding.createEncoder();
    encoding.writeVarUint(step1, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(step1, doc);
    client.send(encoding.toUint8Array(step1));

    client.on('message', (data: Buffer) => {
      const decoder = decoding.createDecoder(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) {
        return;
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, encoder, doc, client);
      if (encoding.length(encoder) > 1) {
        client.send(encoding.toUint8Array(encoder));
      }
    });

    client.on('close', () => clients.delete(client));
  });

  return new Promise((resolve) => {
    httpServer.listen(0, () => {
      const { port } = httpServer.address() as AddressInfo;
      resolve({
        url: `ws://127.0.0.1:${port}`,
        close: () => closeServer(httpServer, wss),
      });
    });
  });
}

function closeServer(httpServer: Server, wss: WebSocketServer): Promise<void> {
  return new Promise((resolve) => {
    wss.close(() => httpServer.close(() => resolve()));
  });
}

function waitUntil(check: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error('Timed out waiting for condition'));
      }
    }, 20);
  });
}

describe('YjsWebsocketClient', () => {
  let server: { url: string; close: () => Promise<void> };

  beforeEach(async () => {
    server = await startTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('converges two clients after either applies an update', async () => {
    const options = { WebSocketImpl: NodeWebSocketClient as unknown as typeof WebSocket };
    const clientA = new YjsWebsocketClient(server.url, new Y.Doc(), options);
    const clientB = new YjsWebsocketClient(server.url, new Y.Doc(), options);

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
      WebSocketImpl: NodeWebSocketClient as unknown as typeof WebSocket,
    });

    await waitUntil(() => statuses.includes('connected'));
    expect(statuses).toEqual(['connecting', 'connected']);

    client.destroy();
  });
});
