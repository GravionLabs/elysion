import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';
import type { WebSocket } from 'ws';
import { InvalidWsTokenError, type WsTokenVerifier } from '../auth/ws-token-verifier.js';
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
    memberBySocket: new Map(),
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

const request = (boardId: string, token: string | null = 'a-token') =>
  ({ url: `/yjs?board=${boardId}${token === null ? '' : `&token=${token}`}` }) as IncomingMessage;

/** A verifier that accepts any token and says it is for `boardId`. */
const allowing = (boardId: string, role: 'owner' | 'editor' | 'viewer' = 'editor') =>
  ({
    verify: vi.fn(async () => ({ sub: 'kc-sub-1', boardId, role })),
  }) as unknown as WsTokenVerifier;
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
    const gateway = new YjsGateway(registry, presence, allowing('board-1'));

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
    const gateway = new YjsGateway(registry, presence, allowing('board-1'));

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
    const gateway = new YjsGateway(registry, presence, allowing('board-1'));

    gateway.handleConnection(client, request('board-1'));
    await flush();

    expect(client.send).toHaveBeenCalledTimes(1);
  });
});

describe('YjsGateway admitting a connection', () => {
  const presence = {
    subscribe: vi.fn().mockResolvedValue(undefined),
    snapshot: vi.fn().mockResolvedValue([]),
  } as unknown as PresenceRelay;
  const setup = (verifier: WsTokenVerifier) => {
    const joined = room('board-1');
    const getOrLoad = vi.fn(async () => joined);
    const gateway = new YjsGateway(
      { getOrLoad, release: vi.fn().mockResolvedValue(undefined) } as unknown as YjsRoomRegistry,
      presence,
      verifier,
    );
    return { gateway, getOrLoad, joined };
  };

  it('lets a connection with a valid token for this board in and binds who it is', async () => {
    const { gateway, joined } = setup(allowing('board-1', 'viewer'));
    const client = socket();

    gateway.handleConnection(client, request('board-1'));
    await flush();

    expect(client.close).not.toHaveBeenCalled();
    expect(joined.clients.has(client)).toBe(true);
    expect(joined.memberBySocket.get(client)).toEqual({ sub: 'kc-sub-1', role: 'viewer' });
  });

  it('closes with 4401, without loading the board, when the token is missing or invalid', async () => {
    const rejecting = {
      verify: vi.fn(async () => {
        throw new InvalidWsTokenError('expired');
      }),
    } as unknown as WsTokenVerifier;
    const { gateway, getOrLoad } = setup(rejecting);
    const client = socket();

    gateway.handleConnection(client, request('board-1', null));
    await flush();

    expect(client.close).toHaveBeenCalledWith(4401, expect.any(String));
    expect(getOrLoad).not.toHaveBeenCalled();
  });

  it('closes with 4403, without loading the board, when the token is for another board', async () => {
    const { gateway, getOrLoad } = setup(allowing('other-board'));
    const client = socket();

    gateway.handleConnection(client, request('board-1'));
    await flush();

    expect(client.close).toHaveBeenCalledWith(4403, expect.any(String));
    expect(getOrLoad).not.toHaveBeenCalled();
  });

  it('closes with 1011 when the check itself breaks, instead of letting the connection in', async () => {
    const broken = {
      verify: vi.fn(async () => {
        throw new Error('boom');
      }),
    } as unknown as WsTokenVerifier;
    const { gateway, joined } = setup(broken);
    const client = socket();

    gateway.handleConnection(client, request('board-1'));
    await flush();

    expect(client.close).toHaveBeenCalledWith(1011, expect.any(String));
    expect(joined.clients.size).toBe(0);
  });

  it('forgets who a connection was when it goes away', async () => {
    const { gateway, joined } = setup(allowing('board-1'));
    const client = socket();
    gateway.handleConnection(client, request('board-1'));
    await flush();

    gateway.handleDisconnect(client);

    expect(joined.memberBySocket.size).toBe(0);
  });

  it('still needs a board id, as before', async () => {
    const { gateway, getOrLoad } = setup(allowing('board-1'));
    const client = socket();

    gateway.handleConnection(client, { url: '/yjs?token=abc' } as IncomingMessage);
    await flush();

    expect(client.close).toHaveBeenCalledWith(1008, 'Missing board id');
    expect(getOrLoad).not.toHaveBeenCalled();
  });
});
