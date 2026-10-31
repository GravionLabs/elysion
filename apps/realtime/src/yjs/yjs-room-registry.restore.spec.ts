import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { WebSocket } from 'ws';
import * as decoding from 'lib0/decoding';
import { InMemoryDocumentStore } from '../persistence/in-memory-document-store.js';
import { inertDocumentRelay } from '../testing/fake-document-relay.js';
import type { PresenceRelay } from '../presence/presence-relay.js';
import { MESSAGE_RESTORED } from './protocol.js';
import { YjsRoomRegistry } from './yjs-room-registry.js';

const OPTIONS = {
  saveDebounceMs: 1_000,
  saveMaxWaitMs: 5_000,
  retryBaseMs: 500,
  retryMaxMs: 4_000,
  evictAfterMs: 10_000,
};

const presence = {
  unsubscribe: vi.fn().mockResolvedValue(undefined),
  recordState: vi.fn().mockResolvedValue(undefined),
  removeState: vi.fn().mockResolvedValue(undefined),
  publish: vi.fn().mockResolvedValue(undefined),
  subscribe: vi.fn().mockResolvedValue(undefined),
  snapshot: vi.fn().mockResolvedValue([]),
} as unknown as PresenceRelay;

const element = (id: string, version: number, x: number) => ({
  id,
  type: 'rectangle',
  x,
  version,
  versionNonce: 1,
  updated: 1,
  isDeleted: false,
});

function stateOf(elements: Record<string, unknown>): Uint8Array {
  const doc = new Y.Doc();
  for (const [id, value] of Object.entries(elements)) doc.getMap('elements').set(id, value);
  return Y.encodeStateAsUpdate(doc);
}

function fakeSocket() {
  const sent: Uint8Array[] = [];
  const socket = { OPEN: 1, readyState: 1, send: (data: Uint8Array) => sent.push(data) };
  return { sent, socket: socket as unknown as WebSocket };
}

describe('YjsRoomRegistry restoreSnapshot', () => {
  let store: InMemoryDocumentStore;
  let registry: YjsRoomRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new InMemoryDocumentStore();
    registry = new YjsRoomRegistry(presence, store, inertDocumentRelay(), OPTIONS);
  });
  afterEach(() => vi.useRealTimers());

  it('restores a board nobody has open, stores it and unloads it after the grace period', async () => {
    await store.save('b', stateOf({ a: element('a', 5, 500) }), null);

    const result = await registry.restoreSnapshot(
      'b',
      stateOf({ a: element('a', 1, 10) }),
      JSON.stringify({ by: 'Ada' }),
    );

    expect(result).toEqual({ restored: 1, removed: 0 });
    const stored = new Y.Doc();
    Y.applyUpdate(stored, store.documents.get('b')!.state);
    expect((stored.getMap('elements').get('a') as { x: number }).x).toBe(10);
    expect(registry.stats().rooms).toBe(1);
    await vi.advanceTimersByTimeAsync(OPTIONS.evictAfterMs + 1);
    expect(registry.stats().rooms).toBe(0);
  });

  it('sends the update and then the announcement to every client of the board', async () => {
    const room = await registry.getOrLoad('b');
    const { sent, socket } = fakeSocket();
    room.clients.add(socket);
    room.doc.getMap('elements').set('a', element('a', 5, 500));

    await registry.restoreSnapshot(
      'b',
      stateOf({ a: element('a', 1, 10) }),
      JSON.stringify({ by: 'Ada', at: '2026-10-31T10:00:00Z' }),
    );

    const last = sent.at(-1)!;
    const decoder = decoding.createDecoder(last);
    expect(decoding.readVarUint(decoder)).toBe(MESSAGE_RESTORED);
    expect(JSON.parse(decoding.readVarString(decoder))).toEqual({
      by: 'Ada',
      at: '2026-10-31T10:00:00Z',
    });
    // The restored content went out as an ordinary document update before the announcement.
    expect(sent.length).toBeGreaterThan(1);
    expect(store.documents.has('b')).toBe(true);
  });
});
