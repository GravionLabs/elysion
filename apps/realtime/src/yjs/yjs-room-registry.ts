import { Injectable } from '@nestjs/common';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import type { WebSocket } from 'ws';
import { MESSAGE_SYNC } from './protocol.js';

export interface YjsRoom {
  readonly boardId: string;
  readonly doc: Y.Doc;
  readonly clients: Set<WebSocket>;
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
  private readonly rooms = new Map<string, YjsRoom>();

  getOrCreate(boardId: string): YjsRoom {
    const existing = this.rooms.get(boardId);
    if (existing) {
      return existing;
    }

    const doc = new Y.Doc();
    const room: YjsRoom = { boardId, doc, clients: new Set() };

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

    this.rooms.set(boardId, room);
    return room;
  }
}
