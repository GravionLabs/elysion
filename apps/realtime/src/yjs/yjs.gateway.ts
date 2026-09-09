import { Injectable, Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import type { IncomingMessage } from 'node:http';
import type { RawData, WebSocket } from 'ws';
import { MESSAGE_AWARENESS, MESSAGE_SYNC } from './protocol.js';
import { YjsRoom, YjsRoomRegistry } from './yjs-room-registry.js';

function toUint8Array(data: RawData): Uint8Array {
  if (Array.isArray(data)) {
    return new Uint8Array(Buffer.concat(data));
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/**
 * Yjs CRDT sync over a plain WebSocket, one room per board id (passed as a
 * `?board=` query param — the gateway's ws path match is exact, so it can't
 * route on a dynamic path segment). Presence/awareness messages are relayed
 * to other clients in the room verbatim, unread — interpreting them is
 * Feature #17's job, this gateway only keeps the wire protocol working for
 * clients that send them.
 */
@Injectable()
@WebSocketGateway({ path: '/yjs' })
export class YjsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(YjsGateway.name);
  private readonly roomByClient = new WeakMap<WebSocket, YjsRoom>();

  constructor(private readonly registry: YjsRoomRegistry) {}

  handleConnection(client: WebSocket, request: IncomingMessage): void {
    const boardId = this.readBoardId(request);
    if (!boardId) {
      client.close(1008, 'Missing board id');
      return;
    }

    const room = this.registry.getOrCreate(boardId);
    room.clients.add(client);
    this.roomByClient.set(client, room);

    client.on('message', (data: RawData) => this.handleMessage(client, room, data));

    this.sendSyncStep1(client, room);
  }

  handleDisconnect(client: WebSocket): void {
    const room = this.roomByClient.get(client);
    room?.clients.delete(client);
    this.roomByClient.delete(client);
  }

  private readBoardId(request: IncomingMessage): string | null {
    const url = new URL(request.url ?? '', 'http://localhost');
    return url.searchParams.get('board');
  }

  private sendSyncStep1(client: WebSocket, room: YjsRoom): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, room.doc);
    this.send(client, encoding.toUint8Array(encoder));
  }

  private handleMessage(client: WebSocket, room: YjsRoom, data: RawData): void {
    const decoder = decoding.createDecoder(toUint8Array(data));
    const messageType = decoding.readVarUint(decoder);

    switch (messageType) {
      case MESSAGE_SYNC: {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, room.doc, client);
        // readSyncMessage only writes a reply for step1/step2, never for a
        // lone update — encoder holding just the type tag means "nothing to say back".
        if (encoding.length(encoder) > 1) {
          this.send(client, encoding.toUint8Array(encoder));
        }
        break;
      }
      case MESSAGE_AWARENESS: {
        this.broadcast(room, toUint8Array(data), client);
        break;
      }
      default:
        this.logger.warn(`Unknown Yjs message type ${messageType}`);
    }
  }

  private send(client: WebSocket, message: Uint8Array): void {
    if (client.readyState === client.OPEN) {
      client.send(message);
    }
  }

  private broadcast(room: YjsRoom, message: Uint8Array, exclude: WebSocket): void {
    for (const client of room.clients) {
      if (client !== exclude) {
        this.send(client, message);
      }
    }
  }
}
