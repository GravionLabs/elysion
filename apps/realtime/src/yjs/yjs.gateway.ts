import {
  WS_CLOSE_FORBIDDEN,
  WS_CLOSE_STALE_COPY,
  WS_CLOSE_UNAUTHORIZED,
  type WsTokenClaims,
} from '@elysion/shared-types';
import {
  type ConnectionContext,
  createConnectionContext,
  runInConnection,
} from '@elysion/node-logging';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import type { IncomingMessage } from 'node:http';
import type { RawData, WebSocket } from 'ws';
import { InvalidWsTokenError, WsTokenVerifier } from '../auth/ws-token-verifier.js';
import { SaveMetrics } from '../metrics/save-metrics.js';
import { PresenceRelay } from '../presence/presence-relay.js';
import { readGeneration } from './generation.js';
import { MESSAGE_AWARENESS, MESSAGE_BOARD_FULL, MESSAGE_SYNC } from './protocol.js';
import { YjsRoom, YjsRoomRegistry } from './yjs-room-registry.js';

/**
 * The largest message one connection may send (a Yjs update or a whole board in sync step 2). The `ws` default is
 * 100 MiB, and a connection can send before its token is checked; a board is far smaller than this.
 */
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;

/**
 * A viewer's connection is read-only. Its sync step 2 and update messages are dropped (never applied, never
 * relayed); this many in total close the connection, so a client that keeps editing is told. A viewer
 * that just looks sends none beyond the one reply to the server's first sync step.
 */
export const MAX_DROPPED_VIEWER_WRITES = 20;

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
 * route on a dynamic path segment). Every connection also carries a `?token=`: the board-scoped WS token the BFF
 * issued (docs/specs/identity.md), verified locally at the handshake and bound to the connection. Presence/awareness messages are relayed
 * verbatim, unread, to every other client in the room — both local (via
 * in-memory broadcast) and on other `realtime` instances (via
 * {@link PresenceRelay}'s Redis pub/sub).
 */
@Injectable()
@WebSocketGateway({ path: '/yjs', maxPayload: MAX_MESSAGE_BYTES })
export class YjsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(YjsGateway.name);
  private readonly roomByClient = new WeakMap<WebSocket, YjsRoom>();
  /** Each connection's request id and user for the logs (ADR 0025), from its upgrade request and verified token. */
  private readonly contextByClient = new WeakMap<WebSocket, ConnectionContext>();
  private readonly droppedViewerWrites = new WeakMap<WebSocket, number>();

  constructor(
    private readonly registry: YjsRoomRegistry,
    private readonly presence: PresenceRelay,
    private readonly tokens: WsTokenVerifier,
    @Optional() private readonly metrics?: SaveMetrics,
  ) {}

  handleConnection(client: WebSocket, request: IncomingMessage): void {
    // The upgrade request's X-Request-Id when it is well formed, a new one otherwise. Everything this connection logs
    // or asks of the business backend carries it, so one id follows a board from the socket to a failed save.
    const context = createConnectionContext(request);
    this.contextByClient.set(client, context);
    runInConnection(context, () => this.open(client, request, context));
  }

  private open(client: WebSocket, request: IncomingMessage, context: ConnectionContext): void {
    const { boardId, token, generation } = this.readQuery(request);
    if (!boardId) {
      client.close(1008, 'Missing board id');
      return;
    }

    // Messages can arrive while the token is being checked and the board's stored state is loading (the browser
    // sends its first sync step on open); handling them in order after the admission keeps them from being dropped.
    let queue: Promise<void> = this.admit(client, boardId, token, generation);
    // A socket's callbacks run outside the context they were registered in: enter the connection's again.
    client.on('message', (data: RawData) => {
      runInConnection(context, () => {
        queue = queue.then(async () => {
          const room = this.roomByClient.get(client);
          if (room) {
            this.handleMessage(client, room, data);
          }
        });
      });
    });
  }

  /**
   * The gate: the connection is let into the room only with a valid WS token for exactly this board. A token for
   * another board would otherwise open every board, which is the point of the token. Failures close the socket
   * with 4401 (no usable token) or 4403 (a valid token for a different board), before the board is even loaded.
   */
  private async admit(
    client: WebSocket,
    boardId: string,
    token: string | null,
    generation: string | null,
  ): Promise<void> {
    let member: WsTokenClaims;
    try {
      member = await this.tokens.verify(token);
    } catch (error) {
      if (error instanceof InvalidWsTokenError) {
        // The reason, never the token (ADR 0025).
        this.logger.warn(
          { reason: error.reason, boardId, closeCode: WS_CLOSE_UNAUTHORIZED },
          'WebSocket connection refused',
        );
        client.close(WS_CLOSE_UNAUTHORIZED, 'Invalid or missing token');
      } else {
        this.logger.error(`WS token check failed: ${String(error)}`);
        client.close(1011, 'Authentication unavailable');
      }
      return;
    }
    // From here on the connection's log lines say whose it is.
    const context = this.contextByClient.get(client);
    if (context) {
      context.userId = member.sub;
    }
    if (member.boardId !== boardId) {
      this.logger.warn(
        { reason: 'wrong_board', boardId, closeCode: WS_CLOSE_FORBIDDEN },
        'WebSocket connection refused',
      );
      client.close(WS_CLOSE_FORBIDDEN, 'Token is for another board');
      return;
    }

    let room: YjsRoom;
    try {
      room = await this.registry.getOrLoad(boardId);
    } catch (error) {
      // Fail closed: serving an empty board in place of the real one would let the next save overwrite it.
      this.logger.error(`Board ${boardId} could not be loaded: ${String(error)}`);
      client.close(1011, 'Board could not be loaded');
      return;
    }
    // A client that holds an older generation of the document must not merge into the rebuilt one (ADR 0026): it throws its
    // copy away and connects again. No `generation` parameter is a first connection; an empty one is a client whose copy has
    // no generation (the board was never rebuilt), which is stale as soon as the document has one.
    if (generation !== null && generation !== (readGeneration(room.doc) ?? '')) {
      this.logger.log(
        { boardId, closeCode: WS_CLOSE_STALE_COPY },
        'WebSocket connection closed: the client holds an older copy of the board',
      );
      client.close(WS_CLOSE_STALE_COPY, 'The board was rebuilt while you were away');
      this.releaseIfEmpty(room);
      return;
    }
    await this.join(client, room, member);
  }

  /** A room that was loaded for a connection that is refused must not stay in memory for ever: let it go the normal way. */
  private releaseIfEmpty(room: YjsRoom): void {
    if (room.clients.size === 0) {
      this.registry
        .release(room)
        .catch((error: unknown) =>
          this.logger.error(`Saving board ${room.boardId} failed: ${String(error)}`),
        );
    }
  }

  private async join(client: WebSocket, room: YjsRoom, member: WsTokenClaims): Promise<void> {
    if (client.readyState !== client.OPEN) {
      return; // gone while the token was checked and the board was loading
    }
    room.memberBySocket.set(client, { sub: member.sub, role: member.role });
    this.logger.log({ boardId: room.boardId, role: member.role }, 'WebSocket connection admitted');
    room.clients.add(client);
    this.roomByClient.set(client, room);
    this.sendSyncStep1(client, room);

    // Subscribe first and wait for it, then read the snapshot. Every announcement is recorded in Valkey
    // before it is published, so one published before the subscription is active is in the snapshot, and one
    // published after reaches the subscription: nothing can fall in between. (Idempotent per board id: later
    // connections wait for the subscription the first one started.)
    try {
      await this.presence.subscribe(room.boardId, (message) => this.broadcastToRoom(room, message));
    } catch (error) {
      this.logger.warn(`Presence subscribe failed for board ${room.boardId}: ${String(error)}`);
    }
    try {
      await this.sendPresenceSnapshot(client, room);
    } catch (error) {
      this.logger.warn(`Presence snapshot failed for board ${room.boardId}: ${String(error)}`);
    }
  }

  handleDisconnect(client: WebSocket): void {
    const context = this.contextByClient.get(client);
    this.contextByClient.delete(client);
    if (context) {
      runInConnection(context, () => this.close(client));
    } else {
      this.close(client);
    }
  }

  private close(client: WebSocket): void {
    const room = this.roomByClient.get(client);
    this.roomByClient.delete(client);
    if (!room) {
      return;
    }
    room.clients.delete(client);
    room.memberBySocket.delete(client);
    this.logger.log({ boardId: room.boardId }, 'WebSocket connection closed');
    this.removeAwarenessOf(room, client);
    if (room.clients.size === 0) {
      this.registry
        .release(room)
        .catch((error: unknown) =>
          this.logger.error(`Saving board ${room.boardId} failed: ${String(error)}`),
        );
    }
  }

  private readQuery(request: IncomingMessage): {
    boardId: string | null;
    token: string | null;
    generation: string | null;
  } {
    const url = new URL(request.url ?? '', 'http://localhost');
    return {
      boardId: url.searchParams.get('board'),
      token: url.searchParams.get('token'),
      generation: url.searchParams.get('generation'),
    };
  }

  private sendSyncStep1(client: WebSocket, room: YjsRoom): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, room.doc);
    this.send(client, encoding.toUint8Array(encoder));
  }

  /**
   * Whatever the reason a socket went away (a clean close, a network drop, a killed browser), the
   * collaborators it announced are gone too: remove them here, from Valkey (the awareness listener of
   * {@link YjsRoomRegistry} does that) and tell every other client, locally and on other instances.
   */
  private removeAwarenessOf(room: YjsRoom, client: WebSocket): void {
    const owned = room.awarenessIdsBySocket.get(client);
    room.awarenessIdsBySocket.delete(client);
    const clientIds = [...(owned ?? [])].filter((clientId) =>
      room.awareness.getStates().has(clientId),
    );
    if (clientIds.length === 0) {
      return;
    }

    awarenessProtocol.removeAwarenessStates(room.awareness, clientIds, 'disconnect');
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(room.awareness, clientIds),
    );
    const message = encoding.toUint8Array(encoder);
    this.broadcastToRoom(room, message);
    this.presence
      .publish(room.boardId, message)
      .catch((error: unknown) =>
        this.logger.warn(`Presence publish failed for board ${room.boardId}: ${String(error)}`),
      );
  }

  private handleMessage(client: WebSocket, room: YjsRoom, data: RawData): void {
    const decoder = decoding.createDecoder(toUint8Array(data));
    const messageType = decoding.readVarUint(decoder);

    switch (messageType) {
      case MESSAGE_SYNC: {
        // A viewer may ask for the board's state (sync step 1) and nothing else: step 2 and updates are writes.
        if (
          room.memberBySocket.get(client)?.role === 'viewer' &&
          decoding.peekVarUint(decoder) !== syncProtocol.messageYjsSyncStep1
        ) {
          this.dropViewerWrite(client, room);
          break;
        }
        const written = this.writtenBytes(decoder);
        if (written !== null) {
          const { maxUpdateBytes } = this.registry.limits;
          if (written.isUpdate && written.bytes > maxUpdateBytes) {
            // One update is a change of one gesture; this is a client that does not behave (ADR 0026).
            this.logger.warn(
              { boardId: room.boardId, bytes: written.bytes },
              'Update refused: larger than one update may be',
            );
            this.metrics?.refused('update');
            client.close(1009, 'That change is too large');
            return;
          }
          if (!this.registry.fits(room, written.bytes)) {
            this.logger.warn(
              { boardId: room.boardId, bytes: written.bytes },
              'Update refused: the board is full',
            );
            this.metrics?.refused('document');
            this.sendBoardFull(client);
            break;
          }
          this.registry.grew(room, written.bytes);
        }
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
          .catch((error: unknown) =>
            this.logger.warn(`Presence publish failed for board ${room.boardId}: ${String(error)}`),
          );
        break;
      }
      default:
        this.logger.warn(`Unknown Yjs message type ${messageType}`);
    }
  }

  /**
   * What a sync message writes into the document, without consuming it: step 2 and an update carry a Yjs update, step 1
   * (a question) none. `null` for a message that writes nothing.
   */
  private writtenBytes(decoder: decoding.Decoder): { bytes: number; isUpdate: boolean } | null {
    const peek = decoding.clone(decoder);
    const type = decoding.readVarUint(peek);
    if (type !== syncProtocol.messageYjsSyncStep2 && type !== syncProtocol.messageYjsUpdate) {
      return null;
    }
    return {
      bytes: decoding.readVarUint8Array(peek).byteLength,
      isUpdate: type === syncProtocol.messageYjsUpdate,
    };
  }

  /** Tells a client that its update was refused because the board is full; it shows the message and keeps what it has. */
  private sendBoardFull(client: WebSocket): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_BOARD_FULL);
    this.send(client, encoding.toUint8Array(encoder));
  }

  /** Drops a viewer's write, and closes the connection when the viewer keeps trying (4403, the contract's "forbidden"). */
  private dropViewerWrite(client: WebSocket, room: YjsRoom): void {
    const dropped = (this.droppedViewerWrites.get(client) ?? 0) + 1;
    this.droppedViewerWrites.set(client, dropped);
    this.logger.debug(`Dropped a write from a viewer on board ${room.boardId} (${dropped})`);
    if (dropped > MAX_DROPPED_VIEWER_WRITES) {
      client.close(WS_CLOSE_FORBIDDEN, 'Viewers cannot change the board');
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
