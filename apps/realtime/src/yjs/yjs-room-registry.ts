import { type ConnectionContext, currentConnection, runInConnection } from '@elysion/node-logging';
import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import type { WebSocket } from 'ws';
import { DocumentRelay, type DocumentMessage } from '../document/document-relay.js';
import { DocumentStore } from '../persistence/document-store.js';
import { PresenceRelay } from '../presence/presence-relay.js';
import type { BoardRole } from '@elysion/shared-types';
import { MESSAGE_SYNC } from './protocol.js';

export interface PersistenceOptions {
  /** A room is saved this long after its last change... */
  readonly saveDebounceMs: number;
  /** ...but at the latest this long after the first unsaved change. */
  readonly saveMaxWaitMs: number;
  /** A failed save is retried after this long, doubling up to {@link retryMaxMs}. */
  readonly retryBaseMs: number;
  readonly retryMaxMs: number;
  /** A room without clients is unloaded this long after its last client left. */
  readonly evictAfterMs: number;
}

export const PERSISTENCE_OPTIONS = Symbol('PERSISTENCE_OPTIONS');

const DEFAULT_PERSISTENCE_OPTIONS: PersistenceOptions = {
  saveDebounceMs: 2_000,
  saveMaxWaitMs: 10_000,
  retryBaseMs: 1_000,
  retryMaxMs: 30_000,
  evictAfterMs: 30_000,
};

/** The defaults, with the grace period before an empty room is unloaded overridable by `ROOM_EVICT_AFTER_MS`. */
export function persistenceOptionsFromEnv(): PersistenceOptions {
  const evictAfterMs = Number(process.env.ROOM_EVICT_AFTER_MS);
  return {
    ...DEFAULT_PERSISTENCE_OPTIONS,
    ...(Number.isFinite(evictAfterMs) && process.env.ROOM_EVICT_AFTER_MS ? { evictAfterMs } : {}),
  };
}

/**
 * Origin of updates that came from another instance. They are broadcast to this instance's clients but neither
 * published again (no ping-pong) nor saved: the instance that received them from a client saves them.
 */
const RELAY_ORIGIN = 'document-relay';

/** Origin of updates merged in from the store; they are broadcast to clients but not saved again by themselves. */
const STORE_ORIGIN = 'document-store';

/** What the registry tracks per room to keep the stored document up to date. */
interface SaveState {
  /** The stored version the next save is based on; `null` while the board has no stored document. */
  version: string | null;
  dirty: boolean;
  firstDirtyAt: number | null;
  timer: NodeJS.Timeout | null;
  saving: Promise<void> | null;
  failures: number;
  evictionTimer: NodeJS.Timeout | null;
  /** Bumped whenever someone asks for the room, so an eviction that was already under way notices and stops. */
  usage: number;
  /** The connection whose change is waiting to be saved: the save is logged and sent to the backend as its request (ADR 0025). */
  connection?: ConnectionContext;
}

export interface YjsRoom {
  readonly boardId: string;
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  readonly clients: Set<WebSocket>;
  /** The awareness client ids each socket announced, so they can be removed when it goes away. */
  readonly awarenessIdsBySocket: Map<WebSocket, Set<number>>;
  /** Who each connected socket is and what it may do, from its verified WS token. */
  readonly memberBySocket: Map<WebSocket, ConnectionMember>;
}

/** The identity bound to a connection at the handshake. */
export interface ConnectionMember {
  /** The user's id at the identity provider. */
  readonly sub: string;
  /** The role on this board; a viewer is read-only. */
  readonly role: BoardRole;
}

/**
 * One in-memory Y.Doc per board id, loaded from the {@link DocumentStore} on first use and kept for the
 * process lifetime (ADR 0011). Docs are shared by reference across all connections for the same board id,
 * so applying an update on one connection updates every client's view of the same object. Changes are
 * saved back a few seconds after the last one, and when the last client leaves.
 */
@Injectable()
export class YjsRoomRegistry implements OnModuleDestroy {
  private readonly logger = new Logger(YjsRoomRegistry.name);
  private readonly rooms = new Map<string, YjsRoom>();
  private readonly loading = new Map<string, Promise<YjsRoom>>();
  private readonly saves = new Map<string, SaveState>();
  private readonly options: PersistenceOptions;

  constructor(
    private readonly presence: PresenceRelay,
    private readonly store: DocumentStore,
    private readonly relay: DocumentRelay,
    @Optional() @Inject(PERSISTENCE_OPTIONS) options?: Partial<PersistenceOptions>,
  ) {
    this.options = { ...DEFAULT_PERSISTENCE_OPTIONS, ...options };
  }

  /**
   * The room for a board, loading its stored state first. Concurrent callers for one board share a single
   * load. Rejects when the store cannot be reached: the caller must not serve an empty board then, because
   * the next save would overwrite the real content.
   */
  getOrLoad(boardId: string): Promise<YjsRoom> {
    const existing = this.rooms.get(boardId);
    if (existing) {
      this.cancelEviction(boardId);
      return Promise.resolve(existing);
    }
    const pending = this.loading.get(boardId);
    if (pending) {
      return pending;
    }

    const load = this.load(boardId).finally(() => this.loading.delete(boardId));
    this.loading.set(boardId, load);
    return load;
  }

  /** What is held in memory right now: the rooms and the connections admitted to them (for the metrics). */
  stats(): { rooms: number; connections: number } {
    let connections = 0;
    for (const room of this.rooms.values()) {
      connections += room.clients.size;
    }
    return { rooms: this.rooms.size, connections };
  }

  /** Saves the room now if it has unsaved changes (used when its last client leaves). */
  async flush(room: YjsRoom): Promise<void> {
    await this.save(room);
  }

  /**
   * Called when the last client of a room has left: saves it now and unloads it after the grace period
   * unless someone connects again. The room is kept while its final save keeps failing.
   */
  async release(room: YjsRoom): Promise<void> {
    await this.save(room);
    if (room.clients.size === 0) {
      this.scheduleEviction(room);
    }
  }

  private scheduleEviction(room: YjsRoom): void {
    const state = this.saves.get(room.boardId);
    if (!state) {
      return;
    }
    if (state.evictionTimer) clearTimeout(state.evictionTimer);
    state.evictionTimer = setTimeout(() => void this.evict(room), this.options.evictAfterMs);
    state.evictionTimer.unref();
  }

  private cancelEviction(boardId: string): void {
    const state = this.saves.get(boardId);
    if (!state) {
      return;
    }
    state.usage += 1;
    if (state.evictionTimer) clearTimeout(state.evictionTimer);
    state.evictionTimer = null;
  }

  private async evict(room: YjsRoom): Promise<void> {
    const state = this.saves.get(room.boardId);
    if (!state || this.rooms.get(room.boardId) !== room) {
      return;
    }
    state.evictionTimer = null;
    const usage = state.usage;
    await this.save(room);
    if (state.usage !== usage || room.clients.size > 0) {
      return; // someone asked for the room meanwhile
    }
    if (state.dirty) {
      this.scheduleEviction(room); // the final save failed: keep the content and try again later
      return;
    }

    if (state.timer) clearTimeout(state.timer);
    this.rooms.delete(room.boardId);
    this.saves.delete(room.boardId);
    room.awareness.destroy();
    room.doc.destroy();
    await this.relay
      .unsubscribe(room.boardId)
      .catch((error: unknown) =>
        this.logger.warn(`Document unsubscribe failed for board ${room.boardId}: ${String(error)}`),
      );
    await this.presence
      .unsubscribe(room.boardId)
      .catch((error: unknown) =>
        this.logger.warn(`Presence unsubscribe failed for board ${room.boardId}: ${String(error)}`),
      );
    this.logger.log(`Unloaded idle board ${room.boardId}`);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([...this.rooms.values()].map((room) => this.save(room)));
    for (const state of this.saves.values()) {
      if (state.timer) clearTimeout(state.timer);
      if (state.evictionTimer) clearTimeout(state.evictionTimer);
    }
  }

  private async load(boardId: string): Promise<YjsRoom> {
    const stored = await this.store.load(boardId);
    const room = this.createRoom(boardId, stored?.state ?? null);
    this.saves.set(boardId, {
      version: stored?.version ?? null,
      dirty: false,
      firstDirtyAt: null,
      timer: null,
      saving: null,
      failures: 0,
      evictionTimer: null,
      usage: 0,
    });
    this.rooms.set(boardId, room);
    this.followRelay(room);
    return room;
  }

  /**
   * Starts exchanging document updates with the other instances serving this board. Not awaited: while Valkey
   * is unreachable the room works on its own (and keeps saving to the store), and the hello exchange heals
   * whatever was missed once the relay is back.
   */
  private followRelay(room: YjsRoom): void {
    const hello = () =>
      this.relay
        .publish(room.boardId, { type: 'hello', data: Y.encodeStateVector(room.doc) })
        .catch((error: unknown) =>
          this.logger.warn(`Document hello failed for board ${room.boardId}: ${String(error)}`),
        );
    this.relay
      .subscribe(room.boardId, {
        onMessage: (message) => this.handleRelayMessage(room, message),
        onReconnect: () => void hello(),
      })
      .then(hello)
      .catch((error: unknown) =>
        this.logger.warn(`Document subscribe failed for board ${room.boardId}: ${String(error)}`),
      );
  }

  private handleRelayMessage(room: YjsRoom, message: DocumentMessage): void {
    if (this.rooms.get(room.boardId) !== room) {
      return; // unloaded meanwhile
    }
    try {
      switch (message.type) {
        case 'update':
          Y.applyUpdate(room.doc, message.data, RELAY_ORIGIN);
          break;
        case 'hello':
          // The peer sends what it has; answer with what it lacks, and ask for what we lack.
          this.publishSafely(room, 'update', Y.encodeStateAsUpdate(room.doc, message.data));
          this.publishSafely(room, 'hello-ack', Y.encodeStateVector(room.doc));
          break;
        case 'hello-ack':
          this.publishSafely(room, 'update', Y.encodeStateAsUpdate(room.doc, message.data));
          break;
      }
    } catch (error) {
      this.logger.warn(
        `Document message for board ${room.boardId} could not be applied: ${String(error)}`,
      );
    }
  }

  private publishSafely(room: YjsRoom, type: DocumentMessage['type'], data: Uint8Array): void {
    this.relay
      .publish(room.boardId, { type, data })
      .catch((error: unknown) =>
        this.logger.warn(`Document ${type} failed for board ${room.boardId}: ${String(error)}`),
      );
  }

  private createRoom(boardId: string, storedState: Uint8Array | null): YjsRoom {
    const doc = new Y.Doc();
    if (storedState) {
      Y.applyUpdate(doc, storedState, STORE_ORIGIN);
    }
    const awareness = new awarenessProtocol.Awareness(doc);
    const room: YjsRoom = {
      boardId,
      doc,
      awareness,
      clients: new Set(),
      awarenessIdsBySocket: new Map(),
      memberBySocket: new Map(),
    };

    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== STORE_ORIGIN && origin !== RELAY_ORIGIN) {
        this.markDirty(room);
        this.relay
          .publish(boardId, { type: 'update', data: update })
          .catch((error: unknown) =>
            this.logger.warn(`Document publish failed for board ${boardId}: ${String(error)}`),
          );
      }
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

    return room;
  }

  private markDirty(room: YjsRoom): void {
    const state = this.saves.get(room.boardId);
    if (!state) {
      return;
    }
    const now = Date.now();
    state.dirty = true;
    state.connection = currentConnection() ?? state.connection;
    state.firstDirtyAt ??= now;
    const delay = Math.max(
      0,
      Math.min(this.options.saveDebounceMs, state.firstDirtyAt + this.options.saveMaxWaitMs - now),
    );
    this.schedule(room, state, delay);
  }

  private schedule(room: YjsRoom, state: SaveState, delay: number): void {
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => void this.save(room), delay);
    state.timer.unref();
  }

  /** Saves the room's state if it changed since the last save; waits for a save already running first. */
  private async save(room: YjsRoom): Promise<void> {
    const state = this.saves.get(room.boardId);
    if (!state) {
      return;
    }
    while (state.saving) {
      await state.saving;
    }
    if (!state.dirty) {
      return;
    }

    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    state.dirty = false;
    state.firstDirtyAt = null;
    // A save runs from a timer, outside any connection: it takes the context of the connection that made the change.
    const write = () => this.writeToStore(room, state);
    state.saving = (state.connection ? runInConnection(state.connection, write) : write()).finally(
      () => (state.saving = null),
    );
    await state.saving;
  }

  private async writeToStore(room: YjsRoom, state: SaveState): Promise<void> {
    try {
      for (;;) {
        const result = await this.store.save(
          room.boardId,
          Y.encodeStateAsUpdate(room.doc),
          state.version,
        );
        if (result.saved) {
          state.version = result.version;
          state.failures = 0;
          return;
        }
        // Another instance saved first. Yjs merges are lossless: take its state in, then save the union.
        Y.applyUpdate(room.doc, result.current.state, STORE_ORIGIN);
        state.version = result.current.version;
      }
    } catch (error) {
      state.dirty = true;
      state.failures += 1;
      const delay = Math.min(
        this.options.retryBaseMs * 2 ** (state.failures - 1),
        this.options.retryMaxMs,
      );
      this.logger.error(
        `Saving board ${room.boardId} failed (attempt ${state.failures}), retrying in ${delay} ms: ${String(error)}`,
      );
      this.schedule(room, state, delay);
    }
  }
}
