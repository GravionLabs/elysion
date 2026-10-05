import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { Redis } from 'ioredis';
import type { WebSocket } from 'ws';
import { DocumentRelay } from '../document/document-relay.js';
import { InMemoryDocumentStore } from '../persistence/in-memory-document-store.js';
import type { PresenceRelay } from '../presence/presence-relay.js';
import { FakeRedisBus, FakeRedisClient } from '../testing/fake-redis.js';
import { YjsRoomRegistry } from './yjs-room-registry.js';

const OPTIONS = { saveDebounceMs: 1_000, saveMaxWaitMs: 5_000, evictAfterMs: 60_000 };

function fakePresence(): PresenceRelay {
  return {
    recordState: vi.fn().mockResolvedValue(undefined),
    removeState: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    snapshot: vi.fn().mockResolvedValue([]),
  } as unknown as PresenceRelay;
}

/** One `realtime` instance: its own registry and relay connections, sharing Valkey (the bus) and the store. */
function instance(bus: FakeRedisBus, store: InMemoryDocumentStore) {
  const pub = new FakeRedisClient(bus);
  const sub = new FakeRedisClient(bus);
  const relay = new DocumentRelay(pub as unknown as Redis, sub as unknown as Redis);
  return { registry: new YjsRoomRegistry(fakePresence(), store, relay, OPTIONS), pub, sub };
}

const elements = (doc: Y.Doc) => doc.getMap('elements').toJSON();
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('YjsRoomRegistry document relay', () => {
  let bus: FakeRedisBus;
  let store: InMemoryDocumentStore;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new FakeRedisBus();
    store = new InMemoryDocumentStore();
  });
  afterEach(() => vi.useRealTimers());

  it('shows a change made on one instance in the same board on another', async () => {
    const a = instance(bus, store);
    const b = instance(bus, store);
    const roomA = await a.registry.getOrLoad('board');
    const roomB = await b.registry.getOrLoad('board');
    await settle();

    roomA.doc.getMap('elements').set('rect', 'drawn on A');
    await settle();

    expect(elements(roomB.doc)).toEqual({ rect: 'drawn on A' });
  });

  it('sends a relayed change on to the clients of the receiving instance', async () => {
    const a = instance(bus, store);
    const b = instance(bus, store);
    const roomA = await a.registry.getOrLoad('board');
    const roomB = await b.registry.getOrLoad('board');
    const socket = { readyState: 1, OPEN: 1, send: vi.fn() } as unknown as WebSocket;
    roomB.clients.add(socket);
    await settle();

    roomA.doc.getMap('elements').set('rect', 'drawn on A');
    await settle();

    expect(socket.send).toHaveBeenCalledTimes(1);
  });

  it('publishes a change once and does not bounce it between the instances', async () => {
    const a = instance(bus, store);
    const b = instance(bus, store);
    const roomA = await a.registry.getOrLoad('board');
    await b.registry.getOrLoad('board');
    await settle();
    const publish = vi.spyOn(bus, 'publish');

    roomA.doc.getMap('elements').set('rect', 'once');
    await settle();

    expect(publish.mock.calls.filter(([channel]) => channel === 'elysion:doc:board')).toHaveLength(
      1,
    );
  });

  it('lets only the instance that got the change from a client save it', async () => {
    const a = instance(bus, store);
    const b = instance(bus, store);
    const roomA = await a.registry.getOrLoad('board');
    await b.registry.getOrLoad('board');
    await settle();
    const save = vi.spyOn(store, 'save');

    roomA.doc.getMap('elements').set('rect', 'x');
    await vi.advanceTimersByTimeAsync(2_000);

    expect(save).toHaveBeenCalledTimes(1);
  });

  it('brings an instance that starts following a board up to date with changes the store does not have yet', async () => {
    const a = instance(bus, store);
    const roomA = await a.registry.getOrLoad('board');
    roomA.doc.getMap('elements').set('rect', 'unsaved on A'); // inside the debounce window: not in the store

    const b = instance(bus, store);
    const roomB = await b.registry.getOrLoad('board'); // loads the stale stored state, then says hello
    await settle();

    expect(elements(roomB.doc)).toEqual({ rect: 'unsaved on A' });
  });

  it('heals changes missed during a Valkey outage, in both directions, when the connection returns', async () => {
    const a = instance(bus, store);
    const b = instance(bus, store);
    const roomA = await a.registry.getOrLoad('board');
    const roomB = await b.registry.getOrLoad('board');
    await settle();

    // B's subscription is down: it hears nothing, while both sides keep editing.
    const channels = new Set(b.sub.subscribedChannels);
    b.sub.subscribedChannels.clear();
    roomA.doc.getMap('elements').set('onlyA', 1);
    roomB.doc.getMap('elements').set('onlyB', 2);
    await settle();
    expect(elements(roomB.doc)).toEqual({ onlyB: 2 });

    // Valkey is back: ioredis resubscribes and reports ready again.
    for (const channel of channels) b.sub.subscribedChannels.add(channel);
    b.sub.emit('ready'); // first 'ready' of the fake: the relay only reports later ones...
    b.sub.emit('ready');
    await settle();

    expect(elements(roomA.doc)).toEqual({ onlyA: 1, onlyB: 2 });
    expect(elements(roomB.doc)).toEqual({ onlyA: 1, onlyB: 2 });
  });

  it('keeps working on its own when publishing fails, and saves the change', async () => {
    const a = instance(bus, store);
    const roomA = await a.registry.getOrLoad('board');
    a.pub.publish = async () => {
      throw new Error('valkey down');
    };

    roomA.doc.getMap('elements').set('rect', 'still saved');
    await vi.advanceTimersByTimeAsync(2_000);

    expect(elements(roomA.doc)).toEqual({ rect: 'still saved' });
    expect(store.documents.has('board')).toBe(true);
  });

  it('stops following the board when its room is unloaded', async () => {
    const a = instance(bus, store);
    const b = instance(bus, store);
    const roomA = await a.registry.getOrLoad('board');
    const roomB = await b.registry.getOrLoad('board');
    await settle();

    await b.registry.release(roomB);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(b.sub.subscribedChannels.has('elysion:doc:board')).toBe(false);
    roomA.doc.getMap('elements').set('late', 1);
    await settle();

    expect(elements(roomB.doc)).toEqual({}); // the unloaded room did not receive it
  });
});
