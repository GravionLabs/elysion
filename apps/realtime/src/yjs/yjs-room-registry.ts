import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import type { WebSocket } from 'ws';
import { DocumentStore } from '../persistence/document-store.js';
import { PresenceRelay } from '../presence/presence-relay.js';
import { MESSAGE_SYNC } from './protocol.js';

export interface PersistenceOptions {
  /** A room is saved this long after its last change... */
  readonly saveDebounceMs: number;
  /** ...but at the latest this long after the first unsaved change. */
  readonly saveMaxWaitMs: number;
  /** A failed save is retried after this long, doubling up to {@link retryMaxMs}. */
  readonly retryBaseMs: number;
  readonly retryMaxMs: number;
}

export const PERSISTENCE_OPTIONS = Symbol('PERSISTENCE_OPTIONS');

const DEFAULT_PERSISTENCE_OPTIONS: PersistenceOptions = {
  saveDebounceMs: 2_000,
  saveMaxWaitMs: 10_000,
  retryBaseMs: 1_000,
  retryMaxMs: 30_000,
};

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
}

export interface YjsRoom {
  readonly boardId: string;
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  readonly clients: Set<WebSocket>;
  /** The awareness client ids each socket announced, so they can be removed when it goes away. */
  readonly awarenessIdsBySocket: Map<WebSocket, Set<number>>;
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

  /** Saves the room now if it has unsaved changes (used when its last client leaves). */
  async flush(room: YjsRoom): Promise<void> {
    await this.save(room);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([...this.rooms.values()].map((room) => this.save(room)));
    for (const state of this.saves.values()) {
      if (state.timer) clearTimeout(state.timer);
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
    });
    this.rooms.set(boardId, room);
    return room;
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
    };

    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== STORE_ORIGIN) {
        this.markDirty(room);
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
    state.saving = this.writeToStore(room, state).finally(() => (state.saving = null));
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
