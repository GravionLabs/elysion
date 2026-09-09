import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { WebSocketServer, type WebSocket as NodeWebSocket } from 'ws';
import { MESSAGE_SYNC } from './protocol.js';

export interface TestYjsServer {
  url: string;
  close: () => Promise<void>;
}

interface Room {
  doc: Y.Doc;
  clients: Set<NodeWebSocket>;
}

/**
 * A minimal stand-in for apps/realtime's YjsGateway — enough of the same
 * sync sub-protocol (including board-scoped rooms via `?board=`) to prove
 * client-side code behaves correctly against any correct server,
 * independent of the real backend (which has its own e2e test covering the
 * server side). Test-only, not shipped.
 */
export function startTestYjsServer(): Promise<TestYjsServer> {
  const rooms = new Map<string, Room>();
  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer });

  function getOrCreateRoom(boardId: string): Room {
    let room = rooms.get(boardId);
    if (!room) {
      const doc = new Y.Doc();
      room = { doc, clients: new Set() };
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.writeUpdate(encoder, update);
        const message = encoding.toUint8Array(encoder);
        for (const client of room!.clients) {
          if (client !== origin && client.readyState === client.OPEN) {
            client.send(message);
          }
        }
      });
      rooms.set(boardId, room);
    }
    return room;
  }

  wss.on('connection', (client, request) => {
    const boardId = new URL(request.url ?? '', 'http://localhost').searchParams.get('board') ?? 'default';
    const room = getOrCreateRoom(boardId);
    room.clients.add(client);

    const step1 = encoding.createEncoder();
    encoding.writeVarUint(step1, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(step1, room.doc);
    client.send(encoding.toUint8Array(step1));

    client.on('message', (data: Buffer) => {
      const decoder = decoding.createDecoder(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) {
        return;
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, encoder, room.doc, client);
      if (encoding.length(encoder) > 1) {
        client.send(encoding.toUint8Array(encoder));
      }
    });

    client.on('close', () => room.clients.delete(client));
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

export function waitUntil(check: () => boolean, timeoutMs = 2000): Promise<void> {
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
