import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { WebSocket } from 'ws';
import {
  DocumentStore,
  type SaveResult,
  type StoredDocument,
} from '../persistence/document-store.js';
import { InMemoryDocumentStore } from '../persistence/in-memory-document-store.js';
import type { PresenceRelay } from '../presence/presence-relay.js';
import { YjsRoomRegistry } from './yjs-room-registry.js';

const OPTIONS = {
  saveDebounceMs: 1_000,
  saveMaxWaitMs: 5_000,
  retryBaseMs: 500,
  retryMaxMs: 4_000,
  evictAfterMs: 10_000,
};

function fakePresence(): PresenceRelay {
  return {
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    recordState: vi.fn().mockResolvedValue(undefined),
    removeState: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    snapshot: vi.fn().mockResolvedValue([]),
  } as unknown as PresenceRelay;
}

/** A document with `entries` in its `elements` map, encoded like a client's state. */
function stateOf(entries: Record<string, string>): Uint8Array {
  const doc = new Y.Doc();
  for (const [key, value] of Object.entries(entries)) doc.getMap('elements').set(key, value);
  return Y.encodeStateAsUpdate(doc);
}

function elementsOf(doc: Y.Doc): Record<string, unknown> {
  return doc.getMap('elements').toJSON();
}

/** A store whose calls can be scripted and inspected. */
class ScriptedStore extends DocumentStore {
  loads: string[] = [];
  saves: { boardId: string; state: Uint8Array; baseVersion: string | null }[] = [];
  deletes: string[] = [];
  loadResult: () => Promise<StoredDocument | null> = async () => null;
  saveResult: () => Promise<SaveResult> = async () => ({
    saved: true,
    version: String(this.saves.length),
  });

  async load(boardId: string) {
    this.loads.push(boardId);
    return this.loadResult();
  }
  async save(boardId: string, state: Uint8Array, baseVersion: string | null) {
    this.saves.push({ boardId, state, baseVersion });
    return this.saveResult();
  }
  async delete(boardId: string) {
    this.deletes.push(boardId);
  }
}

describe('YjsRoomRegistry persistence', () => {
  let store: ScriptedStore;
  let registry: YjsRoomRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new ScriptedStore();
    registry = new YjsRoomRegistry(fakePresence(), store, OPTIONS);
  });
  afterEach(() => vi.useRealTimers());

  describe('loading', () => {
    it('gives a room the stored state before it is returned', async () => {
      store.loadResult = async () => ({ state: stateOf({ a: 'stored' }), version: '3' });

      const room = await registry.getOrLoad('board-1');

      expect(elementsOf(room.doc)).toEqual({ a: 'stored' });
      expect(store.loads).toEqual(['board-1']);
    });

    it('starts an empty room for a board without a stored document', async () => {
      const room = await registry.getOrLoad('new-board');

      expect(elementsOf(room.doc)).toEqual({});
    });

    it('loads once when several connections open a board at the same time', async () => {
      store.loadResult = () => new Promise((resolve) => setTimeout(() => resolve(null), 50));

      const rooms = Promise.all([
        registry.getOrLoad('b'),
        registry.getOrLoad('b'),
        registry.getOrLoad('b'),
      ]);
      await vi.advanceTimersByTimeAsync(60);
      const [first, second, third] = await rooms;

      expect(store.loads).toEqual(['b']);
      expect(second).toBe(first);
      expect(third).toBe(first);
    });

    it('rejects when the store cannot be reached, and tries again on the next connection', async () => {
      store.loadResult = async () => {
        throw new Error('backend down');
      };
      await expect(registry.getOrLoad('b')).rejects.toThrow('backend down');

      store.loadResult = async () => ({ state: stateOf({ a: 'back' }), version: '1' });
      const room = await registry.getOrLoad('b');

      expect(elementsOf(room.doc)).toEqual({ a: 'back' });
      expect(store.loads).toHaveLength(2);
    });

    it('does not save what it just loaded', async () => {
      store.loadResult = async () => ({ state: stateOf({ a: 'stored' }), version: '3' });
      await registry.getOrLoad('b');

      await vi.advanceTimersByTimeAsync(60_000);

      expect(store.saves).toHaveLength(0);
    });
  });

  describe('saving', () => {
    it('saves a changed room once, a debounce after its last change, based on the loaded version', async () => {
      store.loadResult = async () => ({ state: stateOf({ a: '1' }), version: '7' });
      const room = await registry.getOrLoad('b');

      room.doc.getMap('elements').set('b', '2');
      await vi.advanceTimersByTimeAsync(600);
      room.doc.getMap('elements').set('c', '3'); // restarts the debounce
      await vi.advanceTimersByTimeAsync(600);
      expect(store.saves).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(500);

      expect(store.saves).toHaveLength(1);
      expect(store.saves[0].baseVersion).toBe('7');
      const saved = new Y.Doc();
      Y.applyUpdate(saved, store.saves[0].state);
      expect(elementsOf(saved)).toEqual({ a: '1', b: '2', c: '3' });
    });

    it('saves at the latest after the maximum wait while changes keep coming', async () => {
      const room = await registry.getOrLoad('b');

      for (let i = 0; i < 12; i++) {
        room.doc.getMap('elements').set(`k${i}`, 'v');
        await vi.advanceTimersByTimeAsync(500); // never quiet for a full debounce
      }

      expect(store.saves.length).toBeGreaterThanOrEqual(1);
    });

    it('saves a board without a stored document with no base version, then builds on the saved one', async () => {
      const room = await registry.getOrLoad('b');

      room.doc.getMap('elements').set('a', '1');
      await vi.advanceTimersByTimeAsync(1_100);
      room.doc.getMap('elements').set('b', '2');
      await vi.advanceTimersByTimeAsync(1_100);

      expect(store.saves.map((save) => save.baseVersion)).toEqual([null, '1']);
    });

    it('merges what another instance saved first and saves the union', async () => {
      const room = await registry.getOrLoad('b');
      let attempt = 0;
      store.saveResult = async () =>
        ++attempt === 1
          ? {
              saved: false,
              current: { state: stateOf({ other: 'from another instance' }), version: '5' },
            }
          : { saved: true, version: '6' };

      room.doc.getMap('elements').set('mine', 'local');
      await vi.advanceTimersByTimeAsync(1_100);

      expect(store.saves.map((save) => save.baseVersion)).toEqual([null, '5']);
      expect(elementsOf(room.doc)).toEqual({ mine: 'local', other: 'from another instance' });
      const saved = new Y.Doc();
      Y.applyUpdate(saved, store.saves[1].state);
      expect(elementsOf(saved)).toEqual({ mine: 'local', other: 'from another instance' });
    });

    it('retries a failed save with a growing delay and keeps the room until it works', async () => {
      const room = await registry.getOrLoad('b');
      let attempt = 0;
      store.saveResult = async () => {
        if (++attempt <= 2) throw new Error('backend down');
        return { saved: true, version: '1' };
      };

      room.doc.getMap('elements').set('a', '1');
      await vi.advanceTimersByTimeAsync(1_100); // first attempt fails
      expect(store.saves).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(500); // retry after retryBaseMs fails
      expect(store.saves).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(800); // not yet: the delay doubled to 1000 ms
      expect(store.saves).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(300);

      expect(store.saves).toHaveLength(3);
      expect(await registry.getOrLoad('b')).toBe(room);
    });

    it('flush saves a changed room immediately and does nothing for an unchanged one', async () => {
      const room = await registry.getOrLoad('b');
      await registry.flush(room);
      expect(store.saves).toHaveLength(0);

      room.doc.getMap('elements').set('a', '1');
      await registry.flush(room);

      expect(store.saves).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(store.saves).toHaveLength(1); // the debounce timer was cancelled
    });

    it('saves unsaved rooms when the module is destroyed', async () => {
      const room = await registry.getOrLoad('b');
      room.doc.getMap('elements').set('a', '1');

      await registry.onModuleDestroy();

      expect(store.saves).toHaveLength(1);
    });
  });

  describe('unloading idle rooms', () => {
    const connect = (room: { clients: Set<WebSocket> }) => {
      const socket = { readyState: 1, OPEN: 1, send: vi.fn() } as unknown as WebSocket;
      room.clients.add(socket);
      return () => room.clients.delete(socket);
    };

    it('saves a room whose last client left and unloads it after the grace period', async () => {
      const presence = fakePresence();
      registry = new YjsRoomRegistry(presence, store, OPTIONS);
      const room = await registry.getOrLoad('b');
      const leave = connect(room);
      room.doc.getMap('elements').set('a', '1');
      leave();

      await registry.release(room);
      expect(store.saves).toHaveLength(1); // saved at once
      await vi.advanceTimersByTimeAsync(9_000);
      expect(presence.unsubscribe).not.toHaveBeenCalled(); // still inside the grace period
      await vi.advanceTimersByTimeAsync(1_500);

      expect(presence.unsubscribe).toHaveBeenCalledWith('b');
      const again = await registry.getOrLoad('b'); // comes from the store, not from memory
      expect(again).not.toBe(room);
      expect(store.loads).toEqual(['b', 'b']);
    });

    it('keeps the room when a client connects during the grace period', async () => {
      const room = await registry.getOrLoad('b');
      const leave = connect(room);
      leave();
      await registry.release(room);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(await registry.getOrLoad('b')).toBe(room);
      connect(room);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(await registry.getOrLoad('b')).toBe(room);
      expect(store.loads).toEqual(['b']);
    });

    it('does not unload a room that has clients again when the timer fires', async () => {
      const room = await registry.getOrLoad('b');
      connect(room)();
      await registry.release(room);
      connect(room); // joined without going through getOrLoad

      await vi.advanceTimersByTimeAsync(60_000);

      expect(await registry.getOrLoad('b')).toBe(room);
    });

    it('keeps the content while the final save keeps failing, and unloads once it works', async () => {
      const presence = fakePresence();
      registry = new YjsRoomRegistry(presence, store, OPTIONS);
      const room = await registry.getOrLoad('b');
      connect(room)();
      room.doc.getMap('elements').set('a', 'precious');
      let failing = true;
      store.saveResult = async () => {
        if (failing) throw new Error('backend down');
        return { saved: true, version: '1' };
      };
      await registry.release(room);

      await vi.advanceTimersByTimeAsync(35_000); // several grace periods with the backend down
      expect(presence.unsubscribe).not.toHaveBeenCalled(); // still in memory, nothing lost
      failing = false;
      await vi.advanceTimersByTimeAsync(30_000);

      expect(presence.unsubscribe).toHaveBeenCalledWith('b');
      const saved = new Y.Doc();
      Y.applyUpdate(saved, store.saves.at(-1)!.state);
      expect(elementsOf(saved)).toEqual({ a: 'precious' });
    });

    it('does not unload anything while a client is still connected', async () => {
      const presence = fakePresence();
      registry = new YjsRoomRegistry(presence, store, OPTIONS);
      const room = await registry.getOrLoad('b');
      connect(room);

      await vi.advanceTimersByTimeAsync(120_000);

      expect(await registry.getOrLoad('b')).toBe(room);
      expect(presence.unsubscribe).not.toHaveBeenCalled();
    });
  });

  it('round-trips through the in-memory store: a second registry sees what the first saved', async () => {
    const shared = new InMemoryDocumentStore();
    const first = new YjsRoomRegistry(fakePresence(), shared, OPTIONS);
    const room = await first.getOrLoad('b');
    room.doc.getMap('elements').set('a', 'kept');
    await first.flush(room);

    const second = await new YjsRoomRegistry(fakePresence(), shared, OPTIONS).getOrLoad('b');

    expect(elementsOf(second.doc)).toEqual({ a: 'kept' });
  });
});
