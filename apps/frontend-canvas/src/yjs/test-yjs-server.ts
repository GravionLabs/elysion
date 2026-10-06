import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { WebSocketServer, type WebSocket as NodeWebSocket } from 'ws';
import { MESSAGE_AWARENESS, MESSAGE_SYNC } from './protocol.js';

export interface TestYjsServer {
  url: string;
  close: () => Promise<void>;
  /** How many awareness messages the server has received, to tell that nothing is echoed back. */
  awarenessMessagesReceived: () => number;
  /** Drops every connection without a close handshake, like a network failure. */
  dropConnections: () => void;
  /** Closes every socket with a close code, like the gateway does when it cannot load a board (1011). */
  closeConnections: (code: number) => void;
  /** The URL of every connection the server has accepted, in order (to see which token each one carried). */
  connectionUrls: () => string[];
}

interface Room {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  clients: Set<NodeWebSocket>;
  /** The awareness client ids each socket announced, removed with it (as the real gateway does). */
  owned: Map<NodeWebSocket, Set<number>>;
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
  let awarenessMessages = 0;
  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer });

  function getOrCreateRoom(boardId: string): Room {
    let room = rooms.get(boardId);
    if (!room) {
      const doc = new Y.Doc();
      const awareness = new awarenessProtocol.Awareness(doc);
      // The server has no presence of its own.
      awareness.setLocalState(null);
      room = { doc, awareness, clients: new Set(), owned: new Map() };
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

  const connectionUrls: string[] = [];
  wss.on('connection', (client, request) => {
    connectionUrls.push(request.url ?? '');
    const boardId =
      new URL(request.url ?? '', 'http://localhost').searchParams.get('board') ?? 'default';
    const room = getOrCreateRoom(boardId);
    room.clients.add(client);

    const step1 = encoding.createEncoder();
    encoding.writeVarUint(step1, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(step1, room.doc);
    client.send(encoding.toUint8Array(step1));

    // The snapshot of who is already here, as the real gateway pushes it on connect.
    for (const clientId of room.awareness.getStates().keys()) {
      const snapshot = encoding.createEncoder();
      encoding.writeVarUint(snapshot, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        snapshot,
        awarenessProtocol.encodeAwarenessUpdate(room.awareness, [clientId]),
      );
      client.send(encoding.toUint8Array(snapshot));
    }

    client.on('message', (data: Buffer) => {
      const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const decoder = decoding.createDecoder(bytes);
      const type = decoding.readVarUint(decoder);
      if (type === MESSAGE_AWARENESS) {
        awarenessMessages += 1;
        const update = decoding.readVarUint8Array(decoder);
        const before = new Set(room.awareness.getStates().keys());
        awarenessProtocol.applyAwarenessUpdate(room.awareness, update, client);
        const owned = room.owned.get(client) ?? new Set<number>();
        for (const id of room.awareness.getStates().keys()) {
          if (!before.has(id)) owned.add(id);
        }
        room.owned.set(client, owned);
        for (const other of room.clients) {
          if (other !== client && other.readyState === other.OPEN) other.send(bytes);
        }
        return;
      }
      if (type !== MESSAGE_SYNC) {
        return;
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, encoder, room.doc, client);
      if (encoding.length(encoder) > 1) {
        client.send(encoding.toUint8Array(encoder));
      }
    });

    client.on('close', () => {
      room.clients.delete(client);
      const gone = [...(room.owned.get(client) ?? [])].filter((id) =>
        room.awareness.getStates().has(id),
      );
      room.owned.delete(client);
      if (gone.length === 0) return;
      awarenessProtocol.removeAwarenessStates(room.awareness, gone, 'disconnect');
      const removal = encoding.createEncoder();
      encoding.writeVarUint(removal, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        removal,
        awarenessProtocol.encodeAwarenessUpdate(room.awareness, gone),
      );
      const message = encoding.toUint8Array(removal);
      for (const other of room.clients) {
        if (other.readyState === other.OPEN) other.send(message);
      }
    });
  });

  return new Promise((resolve) => {
    httpServer.listen(0, () => {
      const { port } = httpServer.address() as AddressInfo;
      resolve({
        url: `ws://127.0.0.1:${port}`,
        close: () => closeServer(httpServer, wss),
        awarenessMessagesReceived: () => awarenessMessages,
        dropConnections: () => {
          for (const client of wss.clients) client.terminate();
        },
        connectionUrls: () => [...connectionUrls],
        closeConnections: (code) => {
          for (const client of wss.clients) client.close(code);
        },
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
