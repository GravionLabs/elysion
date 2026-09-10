import { Injectable, Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import type { IncomingMessage } from 'node:http';
import type { RawData, WebSocket } from 'ws';
import { PresenceRelay } from '../presence/presence-relay.js';
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
 * verbatim, unread, to every other client in the room — both local (via
 * in-memory broadcast) and on other `realtime` instances (via
 * {@link PresenceRelay}'s Redis pub/sub).
 */
@Injectable()
@WebSocketGateway({ path: '/yjs' })
export class YjsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(YjsGateway.name);
  private readonly roomByClient = new WeakMap<WebSocket, YjsRoom>();

  constructor(
    private readonly registry: YjsRoomRegistry,
    private readonly presence: PresenceRelay,
  ) {}

  handleConnection(client: WebSocket, request: IncomingMessage): void {
    const boardId = this.readBoardId(request);
    if (!boardId) {
      client.close(1008, 'Missing board id');
      return;
    }

    const room = this.registry.getOrCreate(boardId);
    room.clients.add(client);
    this.roomByClient.set(client, room);

    // Idempotent per board id — a no-op for every connection after the room's first.
    this.presence
      .subscribe(boardId, (message) => this.broadcastToRoom(room, message))
      .catch((error: unknown) => this.logger.warn(`Presence subscribe failed for board ${boardId}: ${String(error)}`));

    client.on('message', (data: RawData) => this.handleMessage(client, room, data));

    this.sendSyncStep1(client, room);
    this.sendPresenceSnapshot(client, room).catch((error: unknown) =>
      this.logger.warn(`Presence snapshot failed for board ${boardId}: ${String(error)}`),
    );
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
        const bytes = toUint8Array(data);
        const update = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(room.awareness, update, client);
        this.broadcast(room, bytes, client);
        this.presence
          .publish(room.boardId, bytes)
          .catch((error: unknown) => this.logger.warn(`Presence publish failed for board ${room.boardId}: ${String(error)}`));
        break;
      }
      default:
        this.logger.warn(`Unknown Yjs message type ${messageType}`);
    }
  }

  /** Catches a newly-connected client up on every other client's current presence, persisted in Redis by {@link YjsRoomRegistry}. */
  private async sendPresenceSnapshot(client: WebSocket, room: YjsRoom): Promise<void> {
    const updates = await this.presence.snapshot(room.boardId);
    for (const update of updates) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(encoder, update);
      this.send(client, encoding.toUint8Array(encoder));
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

  /** Like {@link broadcast}, but with no local exclusion — used for messages relayed in from another instance via Redis. */
  private broadcastToRoom(room: YjsRoom, message: Uint8Array): void {
    for (const client of room.clients) {
      this.send(client, message);
    }
  }
}
