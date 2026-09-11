import { describe, expect, it, vi } from 'vitest';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';
import { PresenceRelay } from '../presence/presence-relay.js';
import { YjsRoomRegistry } from './yjs-room-registry.js';

function fakePresence(): PresenceRelay {
  return {
    recordState: vi.fn().mockResolvedValue(undefined),
    removeState: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    snapshot: vi.fn().mockResolvedValue([]),
  } as unknown as PresenceRelay;
}

/** Simulates a remote peer setting `state` on `clientId`, returning the encoded update bytes a real client would send. */
function encodeRemoteState(clientId: number, state: Record<string, unknown> | null): Uint8Array {
  const doc = new Y.Doc();
  doc.clientID = clientId;
  // The Awareness constructor seeds meta for clientId with an initial `{}` state at clock 0 —
  // mirroring that here means our setLocalState call below lands at clock 1, same as a real client's first announce.
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(state);
  return awarenessProtocol.encodeAwarenessUpdate(awareness, [clientId]);
}

describe('YjsRoomRegistry presence persistence', () => {
  it('persists a new client awareness state to Redis via PresenceRelay.recordState', () => {
    const presence = fakePresence();
    const registry = new YjsRoomRegistry(presence);
    const room = registry.getOrCreate('board-1');

    const update = encodeRemoteState(42, { name: 'Ada', cursor: { x: 1, y: 2 } });
    awarenessProtocol.applyAwarenessUpdate(room.awareness, update, 'test');

    expect(presence.recordState).toHaveBeenCalledTimes(1);
    const [boardId, clientId, storedUpdate] = (presence.recordState as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, number, Uint8Array];
    expect(boardId).toBe('board-1');
    expect(clientId).toBe(42);

    // The persisted bytes must round-trip through applyAwarenessUpdate into the same state.
    const readBack = new awarenessProtocol.Awareness(new Y.Doc());
    awarenessProtocol.applyAwarenessUpdate(readBack, storedUpdate, 'readback');
    expect(readBack.getStates().get(42)).toEqual({ name: 'Ada', cursor: { x: 1, y: 2 } });
  });

  it('removes a client from Redis when its awareness state is cleared', () => {
    const presence = fakePresence();
    const registry = new YjsRoomRegistry(presence);
    const room = registry.getOrCreate('board-2');

    awarenessProtocol.applyAwarenessUpdate(room.awareness, encodeRemoteState(7, { name: 'Bob' }), 'test');
    expect(presence.removeState).not.toHaveBeenCalled();

    awarenessProtocol.removeAwarenessStates(room.awareness, [7], 'test');

    expect(presence.removeState).toHaveBeenCalledWith('board-2', 7);
  });

  it('returns the same room instance for repeated calls with the same board id', () => {
    const registry = new YjsRoomRegistry(fakePresence());
    expect(registry.getOrCreate('board-3')).toBe(registry.getOrCreate('board-3'));
  });
});
