import { Injectable, Logger } from '@nestjs/common';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import type { WebSocket } from 'ws';
import { PresenceRelay } from '../presence/presence-relay.js';
import { MESSAGE_SYNC } from './protocol.js';

export interface YjsRoom {
  readonly boardId: string;
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  readonly clients: Set<WebSocket>;
  /** The awareness client ids each socket announced, so they can be removed when it goes away. */
  readonly awarenessIdsBySocket: Map<WebSocket, Set<number>>;
}

/**
 * One in-memory Y.Doc per board id, created lazily on first connection and
 * kept for the process lifetime — no persistence, no cross-instance
 * broadcast (Redis) yet. Docs are shared by reference across all
 * connections for the same board id, so applying an update on one
 * connection updates every client's view of the same object.
 */
@Injectable()
export class YjsRoomRegistry {
  private readonly logger = new Logger(YjsRoomRegistry.name);
  private readonly rooms = new Map<string, YjsRoom>();

  constructor(private readonly presence: PresenceRelay) {}

  getOrCreate(boardId: string): YjsRoom {
    const existing = this.rooms.get(boardId);
    if (existing) {
      return existing;
    }

    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    const room: YjsRoom = {
      boardId,
      doc,
      awareness,
      clients: new Set(),
      awarenessIdsBySocket: new Map(),
    };

    doc.on('update', (update: Uint8Array, origin: unknown) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);

      for (const client of room.clients) {
        if (client !== origin && client.readyState === client.OPEN) {
          client.send(message);
        }
      }
    });

    // Persists every local awareness change to Redis (keyed by board + client
    // id) so a client joining any instance — including one seeing this board
    // for the first time — can be caught up with a snapshot. Fires both for
    // locally-received client updates and for this instance's own removals.
    awareness.on(
      'update',
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        // Remember which socket owns which awareness client id (an update applied for a socket has it as origin).
        const socket = [...room.clients].find((client) => client === origin);
        if (socket) {
          const owned = room.awarenessIdsBySocket.get(socket) ?? new Set<number>();
          for (const clientId of [...added, ...updated]) owned.add(clientId);
          for (const clientId of removed) owned.delete(clientId);
          room.awarenessIdsBySocket.set(socket, owned);
        }
        for (const clientId of [...added, ...updated]) {
          this.presence
            .recordState(
              boardId,
              clientId,
              awarenessProtocol.encodeAwarenessUpdate(awareness, [clientId]),
            )
            .catch((error: unknown) =>
              this.logger.warn(
                `Presence recordState failed for board ${boardId} client ${clientId}: ${String(error)}`,
              ),
            );
        }
        for (const clientId of removed) {
          this.presence
            .removeState(boardId, clientId)
            .catch((error: unknown) =>
              this.logger.warn(
                `Presence removeState failed for board ${boardId} client ${clientId}: ${String(error)}`,
              ),
            );
        }
      },
    );

    this.rooms.set(boardId, room);
    return room;
  }
}
