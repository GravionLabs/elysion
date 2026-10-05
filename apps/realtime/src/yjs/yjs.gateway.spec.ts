import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';
import type { WebSocket } from 'ws';
import { InvalidWsTokenError, type WsTokenVerifier } from '../auth/ws-token-verifier.js';
import type { PresenceRelay } from '../presence/presence-relay.js';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { MAX_DROPPED_VIEWER_WRITES, YjsGateway } from './yjs.gateway.js';
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

describe('YjsGateway and read-only viewers', () => {
  const presence = {
    subscribe: vi.fn().mockResolvedValue(undefined),
    snapshot: vi.fn().mockResolvedValue([]),
    publish: vi.fn().mockResolvedValue(undefined),
  } as unknown as PresenceRelay;

  async function join(role: 'owner' | 'editor' | 'viewer') {
    const joined = room('board-1');
    const gateway = new YjsGateway(
      { getOrLoad: async () => joined, release: vi.fn() } as unknown as YjsRoomRegistry,
      presence,
      allowing('board-1', role),
    );
    const client = socket();
    gateway.handleConnection(client, request('board-1'));
    await flush();
    (client.send as ReturnType<typeof vi.fn>).mockClear();
    return { client, joined };
  }

  /** What a client sends: a sync message of a given kind. */
  function syncMessage(write: (encoder: encoding.Encoder) => void): Buffer {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0); // MESSAGE_SYNC
    write(encoder);
    return Buffer.from(encoding.toUint8Array(encoder));
  }

  /** An update that sets a key in a document of its own. */
  function updateOf(key: string): Uint8Array {
    const source = new Y.Doc();
    let update!: Uint8Array;
    source.on('update', (u: Uint8Array) => (update = u));
    source.getMap('elements').set(key, 1);
    return update;
  }

  const send = async (client: WebSocket, data: Buffer) => {
    client.emit('message', data);
    await flush();
  };

  it('applies an update from an editor', async () => {
    const { client, joined } = await join('editor');

    await send(
      client,
      syncMessage((e) => syncProtocol.writeUpdate(e, updateOf('rect'))),
    );

    expect(joined.doc.getMap('elements').has('rect')).toBe(true);
  });

  it('drops an update from a viewer: not applied', async () => {
    const { client, joined } = await join('viewer');

    await send(
      client,
      syncMessage((e) => syncProtocol.writeUpdate(e, updateOf('rect'))),
    );

    expect(joined.doc.getMap('elements').has('rect')).toBe(false);
  });

  it('drops sync step 2 from a viewer too: it carries state, which is a write', async () => {
    const { client, joined } = await join('viewer');
    const source = new Y.Doc();
    source.getMap('elements').set('rect', 1);

    await send(
      client,
      syncMessage((e) => syncProtocol.writeSyncStep2(e, source)),
    );

    expect(joined.doc.getMap('elements').has('rect')).toBe(false);
  });

  it("answers a viewer's sync step 1 with the board state: viewing works", async () => {
    const { client, joined } = await join('viewer');
    joined.doc.getMap('elements').set('existing', 1);

    await send(
      client,
      syncMessage((e) => syncProtocol.writeSyncStep1(e, new Y.Doc())),
    );

    expect(client.send).toHaveBeenCalledTimes(1);
  });

  it("relays a viewer's awareness: cursors still work", async () => {
    const { client } = await join('viewer');
    const other = new awarenessProtocol.Awareness(new Y.Doc());
    other.setLocalState({ user: { name: 'Vera' } });
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 1); // MESSAGE_AWARENESS
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(other, [other.clientID]),
    );

    await send(client, Buffer.from(encoding.toUint8Array(encoder)));

    expect(presence.publish).toHaveBeenCalledWith('board-1', expect.any(Uint8Array));
  });

  it('closes a viewer who keeps sending writes, with 4403, but not one who sent a few', async () => {
    const { client } = await join('viewer');
    const write = syncMessage((e) => syncProtocol.writeUpdate(e, updateOf('rect')));

    for (let i = 0; i < MAX_DROPPED_VIEWER_WRITES; i++) await send(client, write);
    expect(client.close).not.toHaveBeenCalled();
    await send(client, write);

    expect(client.close).toHaveBeenCalledWith(4403, 'Viewers cannot change the board');
  });
});
