import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { Redis } from 'ioredis';
import { DocumentRelay } from '../document/document-relay.js';
import { inertDocumentRelay } from '../testing/fake-document-relay.js';
import { SaveMetrics } from '../metrics/save-metrics.js';
import { InMemoryDocumentStore } from '../persistence/in-memory-document-store.js';
import type { PresenceRelay } from '../presence/presence-relay.js';
import { FakeRedisBus, FakeRedisClient } from '../testing/fake-redis.js';
import { readGeneration } from './generation.js';
import { YjsRoomRegistry } from './yjs-room-registry.js';

const OPTIONS = {
  saveDebounceMs: 100,
  saveMaxWaitMs: 500,
  evictAfterMs: 1_000,
  compactAboveBytes: 20_000,
};

function fakePresence(others: Uint8Array[] = []): PresenceRelay {
  return {
    recordState: vi.fn().mockResolvedValue(undefined),
    removeState: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    snapshot: vi.fn().mockResolvedValue(others),
  } as unknown as PresenceRelay;
}

function instance(
  bus: FakeRedisBus,
  store: InMemoryDocumentStore,
  presence = fakePresence(),
  options: Partial<typeof OPTIONS> = {},
  metrics?: SaveMetrics,
) {
  const relay = new DocumentRelay(
    new FakeRedisClient(bus) as unknown as Redis,
    new FakeRedisClient(bus) as unknown as Redis,
  );
  const registry = new YjsRoomRegistry(presence, store, relay, { ...OPTIONS, ...options }, metrics);
  return { registry, presence };
}

/** A board that was dragged around for a long time: `writes` writes spread over `elements` elements. */
function drag(doc: Y.Doc, elements: number, writes: number): void {
  const map = doc.getMap<unknown>('elements');
  for (let i = 0; i < writes; i++) {
    map.set(`e${i % elements}`, { id: `e${i % elements}`, x: i, y: i * 2, version: i });
  }
}

const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
const sizeOf = (store: InMemoryDocumentStore, id: string) => store.documents.get(id)!.state.length;

describe('compaction of an idle board (ADR 0026)', () => {
  let bus: FakeRedisBus;
  let store: InMemoryDocumentStore;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new FakeRedisBus();
    store = new InMemoryDocumentStore();
  });
  afterEach(() => vi.useRealTimers());

  /** Draws on a board, lets it be saved, and lets it go idle (no client ever connected, so the room is released by hand). */
  async function drawAndLeave(a: ReturnType<typeof instance>, id = 'board') {
    const room = await a.registry.getOrLoad(id);
    drag(room.doc, 50, 3_000);
    await settle(200);
    await a.registry.release(room);
    return room;
  }

  it('rebuilds a large board when its idle copy is unloaded: smaller, the same elements, a new generation', async () => {
    const metrics = new SaveMetrics();
    const a = instance(bus, store, fakePresence(), {}, metrics);
    const room = await a.registry.getOrLoad('board');
    drag(room.doc, 50, 3_000);
    const before = Y.encodeStateAsUpdate(room.doc).byteLength;
    const expected = room.doc.getMap('elements').toJSON();
    await settle(200);
    await a.registry.release(room);

    await settle(2_000); // the grace period ends

    expect(sizeOf(store, 'board')).toBeLessThan(before / 2);
    const loaded = new Y.Doc();
    Y.applyUpdate(loaded, store.documents.get('board')!.state);
    expect(loaded.getMap('elements').toJSON()).toEqual(expected);
    expect(readGeneration(loaded)).toMatch(/^[0-9a-f-]{36}$/);
    expect(await metrics.registry.metrics()).toContain(
      'elysion_realtime_document_compactions_total 1',
    );
  });

  it('serves the rebuilt document to the next client, and it saves nothing by itself', async () => {
    const a = instance(bus, store);
    await drawAndLeave(a);
    await settle(2_000);
    const stored = store.documents.get('board')!;

    const room = await a.registry.getOrLoad('board');
    await settle(5_000);

    expect(Object.keys(room.doc.getMap('elements').toJSON())).toHaveLength(50);
    expect(readGeneration(room.doc)).toBeDefined();
    expect(store.documents.get('board')!.version).toBe(stored.version);
  });

  it('never rebuilds a board under the threshold', async () => {
    const a = instance(bus, store, fakePresence(), { compactAboveBytes: 10_000_000 });
    await drawAndLeave(a);
    const before = sizeOf(store, 'board');

    await settle(2_000);

    expect(sizeOf(store, 'board')).toBe(before);
    const loaded = new Y.Doc();
    Y.applyUpdate(loaded, store.documents.get('board')!.state);
    expect(readGeneration(loaded)).toBeUndefined();
  });

  it('is off when the threshold is 0', async () => {
    const a = instance(bus, store, fakePresence(), { compactAboveBytes: 0 });
    await drawAndLeave(a);
    const before = sizeOf(store, 'board');

    await settle(2_000);

    expect(sizeOf(store, 'board')).toBe(before);
  });

  it('does not rebuild a board that has nothing to win (every write is a new element)', async () => {
    const a = instance(bus, store);
    const room = await a.registry.getOrLoad('board');
    drag(room.doc, 3_000, 3_000);
    await settle(200);
    await a.registry.release(room);
    const before = sizeOf(store, 'board');

    await settle(2_000);

    expect(sizeOf(store, 'board')).toBe(before);
  });

  it('does not rebuild while somebody, on another instance, still has the board open', async () => {
    const a = instance(bus, store, fakePresence([new Uint8Array([1])]));
    await drawAndLeave(a);
    const before = sizeOf(store, 'board');

    await settle(2_000);

    expect(sizeOf(store, 'board')).toBe(before);
  });

  it('does nothing when the presence check fails', async () => {
    const presence = fakePresence();
    (presence.snapshot as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('valkey down'));
    const a = instance(bus, store, presence);
    await drawAndLeave(a);
    const before = sizeOf(store, 'board');

    await settle(2_000);

    expect(sizeOf(store, 'board')).toBe(before);
    expect(await a.registry.getOrLoad('board')).toBeDefined();
  });

  it('lets another instance drop its idle copy, so that it does not save over the rebuilt document', async () => {
    const a = instance(bus, store);
    const b = instance(bus, store);
    const roomB = await b.registry.getOrLoad('board');
    const roomA = await a.registry.getOrLoad('board');
    drag(roomA.doc, 50, 3_000);
    await settle(200);
    await a.registry.release(roomA);
    expect(Object.keys(roomB.doc.getMap('elements').toJSON())).toHaveLength(50);

    await settle(2_000);

    // B's room was dropped by the reset; asking for the board loads the rebuilt document.
    const reloaded = await b.registry.getOrLoad('board');
    expect(reloaded).not.toBe(roomB);
    expect(readGeneration(reloaded.doc)).toBeDefined();
  });

  it('keeps an idle copy that has unsaved changes when a reset arrives', async () => {
    const a = instance(bus, store);
    const b = instance(bus, store);
    const roomB = await b.registry.getOrLoad('board');
    await settle(0);
    roomB.doc.getMap('elements').set('mine', 1); // unsaved

    await a.registry.getOrLoad('board');
    // a reset from another instance
    new FakeRedisClient(bus).publish(
      'elysion:doc:board',
      JSON.stringify({ from: 'other', type: 'reset', data: '' }),
    );
    await settle(0);

    expect(await b.registry.getOrLoad('board')).toBe(roomB);
  });
});

describe('the size of a board (ADR 0026)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const small = () =>
    new YjsRoomRegistry(fakePresence(), new InMemoryDocumentStore(), inertDocumentRelay(), {
      maxDocumentBytes: 1_000,
    });

  it('lets an update in while the estimate says it fits', async () => {
    const registry = small();
    const room = await registry.getOrLoad('board');

    expect(registry.fits(room, 900)).toBe(true);
    registry.grew(room, 900);
    expect(registry.fits(room, 50)).toBe(true);
  });

  it('measures the real state when the estimate says no, and lets the update in when it still fits', async () => {
    const registry = small();
    const room = await registry.getOrLoad('board');
    registry.grew(room, 5_000); // an estimate far above the real (empty) state

    expect(registry.fits(room, 400)).toBe(true);
    expect(room.sizeBytes).toBeLessThan(100);
  });

  it('refuses an update that does not fit the real state either', async () => {
    const registry = small();
    const room = await registry.getOrLoad('board');
    drag(room.doc, 5, 200); // the real state is far above 1,000 bytes
    registry.grew(room, 5_000);

    expect(registry.fits(room, 400)).toBe(false);
  });
});
