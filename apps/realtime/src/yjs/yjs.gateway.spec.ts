import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';
import type { WebSocket } from 'ws';
import type { PresenceRelay } from '../presence/presence-relay.js';
import { YjsGateway } from './yjs.gateway.js';
import type { YjsRoom, YjsRoomRegistry } from './yjs-room-registry.js';

function room(boardId: string): YjsRoom {
  const doc = new Y.Doc();
  return {
    boardId,
    doc,
    awareness: new awarenessProtocol.Awareness(doc),
    clients: new Set(),
    awarenessIdsBySocket: new Map(),
  };
}

function socket(): WebSocket {
  return Object.assign(new EventEmitter(), {
    readyState: 1,
    OPEN: 1,
    send: vi.fn(),
    close: vi.fn(),
  }) as unknown as WebSocket;
}

const request = (boardId: string) => ({ url: `/yjs?board=${boardId}` }) as IncomingMessage;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('YjsGateway joining a room', () => {
  it('reads the presence snapshot only after the presence subscription is active', async () => {
    const calls: string[] = [];
    let activate!: () => void;
    const presence = {
      subscribe: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            calls.push('subscribe');
            activate = () => {
              calls.push('subscribed');
              resolve();
            };
          }),
      ),
      snapshot: vi.fn(async () => {
        calls.push('snapshot');
        return [];
      }),
    } as unknown as PresenceRelay;
    const registry = { getOrLoad: async (id: string) => room(id) } as unknown as YjsRoomRegistry;
    const gateway = new YjsGateway(registry, presence);

    gateway.handleConnection(socket(), request('board-1'));
    await flush();
    expect(calls).toEqual(['subscribe']); // the snapshot waits for the subscription

    activate();
    await flush();

    expect(calls).toEqual(['subscribe', 'subscribed', 'snapshot']);
  });

  it('still reads the snapshot, and logs, when the subscription fails', async () => {
    const presence = {
      subscribe: vi.fn().mockRejectedValue(new Error('valkey down')),
      snapshot: vi.fn().mockResolvedValue([]),
    } as unknown as PresenceRelay;
    const registry = { getOrLoad: async (id: string) => room(id) } as unknown as YjsRoomRegistry;
    const gateway = new YjsGateway(registry, presence);

    gateway.handleConnection(socket(), request('board-1'));
    await flush();

    expect(presence.snapshot).toHaveBeenCalledWith('board-1');
  });

  it('sends the sync handshake to the client before it waits for the subscription', async () => {
    const client = socket();
    const presence = {
      subscribe: vi.fn(() => new Promise<void>(() => undefined)), // never becomes active
      snapshot: vi.fn().mockResolvedValue([]),
    } as unknown as PresenceRelay;
    const registry = { getOrLoad: async (id: string) => room(id) } as unknown as YjsRoomRegistry;
    const gateway = new YjsGateway(registry, presence);

    gateway.handleConnection(client, request('board-1'));
    await flush();

    expect(client.send).toHaveBeenCalledTimes(1);
  });
});
