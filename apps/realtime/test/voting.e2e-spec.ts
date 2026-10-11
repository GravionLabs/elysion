import { randomUUID } from 'node:crypto';
import * as decoding from 'lib0/decoding';
import { SignJWT } from 'jose';
import { WebSocket, type RawData } from 'ws';
import { InMemoryDocumentStore } from '../src/persistence/in-memory-document-store.js';
import { MESSAGE_VOTING } from '../src/yjs/protocol.js';
import { startInstance, waitUntil } from './helpers.js';
import { boardUrl } from './ws-token.js';

/**
 * The business backend announces a change of a board's voting to the realtime service (ADR 0029); every client of the board,
 * on every instance and whatever its role, receives it as message type 5.
 */
const INTERNAL_SECRET = 'test-only-internal-api-secret-0123456789abcdef';
const slowSaves = { saveDebounceMs: 60_000, saveMaxWaitMs: 60_000, evictAfterMs: 60_000 };

const voting = {
  id: 'v1',
  name: 'Ideas',
  votesPerPerson: 3,
  status: 'open',
  named: false,
  startedBy: { id: 'u1', name: 'Ada' },
  startedAt: '2026-10-11T10:00:00Z',
  closedAt: null,
  placed: { u1: 1 },
};

async function serviceToken(
  claims: { iss?: string; aud?: string; exp?: number; secret?: string } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT()
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(claims.iss ?? 'elysion-business-backend')
    .setAudience(claims.aud ?? 'elysion-realtime')
    .setIssuedAt(now)
    .setExpirationTime(claims.exp ?? now + 60)
    .sign(new TextEncoder().encode(claims.secret ?? INTERNAL_SECRET));
}

/** A socket that keeps the voting messages it receives. */
class Listener {
  readonly received: unknown[] = [];
  private readonly socket: WebSocket;

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.on('message', (data: RawData) => {
      const bytes = data as Buffer;
      const decoder = decoding.createDecoder(new Uint8Array(bytes));
      if (decoding.readVarUint(decoder) === MESSAGE_VOTING) {
        this.received.push(JSON.parse(decoding.readVarString(decoder)));
      }
    });
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.once('open', () => resolve());
      this.socket.once('error', reject);
    });
  }

  send(data: Uint8Array): void {
    this.socket.send(data);
  }

  close(): void {
    this.socket.close();
  }
}

const httpOf = (wsUrl: string) => wsUrl.replace('ws://', 'http://').replace('/yjs', '');

async function announce(
  instanceUrl: string,
  boardId: string,
  body: unknown,
  authorization?: string,
): Promise<Response> {
  return fetch(`${httpOf(instanceUrl)}/internal/boards/${boardId}/voting`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authorization === undefined ? {} : { authorization }),
    },
    body: JSON.stringify(body),
  });
}

describe('Voting notifications (e2e)', () => {
  it('reach an editor and a viewer on the instance that got the call and a client on the other instance', async () => {
    const store = new InMemoryDocumentStore();
    const boardId = randomUUID();
    const a = await startInstance(store, slowSaves);
    const b = await startInstance(store, slowSaves);
    const editor = new Listener(boardUrl(a.url, boardId));
    const viewer = new Listener(boardUrl(a.url, boardId, { role: 'viewer', sub: 'v' }));
    const remote = new Listener(boardUrl(b.url, boardId, { role: 'viewer', sub: 'w' }));
    await Promise.all([editor.open(), viewer.open(), remote.open()]);
    await new Promise((resolve) => setTimeout(resolve, 300)); // both rooms follow the relay

    const response = await announce(
      a.url,
      boardId,
      { event: 'start', voting },
      `Bearer ${await serviceToken()}`,
    );

    expect(response.status).toBe(204);
    await waitUntil(() => [editor, viewer, remote].every((l) => l.received.length === 1));
    for (const listener of [editor, viewer, remote]) {
      expect(listener.received[0]).toEqual({ event: 'start', voting });
    }
    editor.close();
    viewer.close();
    remote.close();
    await Promise.all([a.app.close(), b.app.close()]);
  });

  it('reaches the clients of an instance that did not get the call, and one with no clients is no problem', async () => {
    const store = new InMemoryDocumentStore();
    const boardId = randomUUID();
    const a = await startInstance(store, slowSaves);
    const b = await startInstance(store, slowSaves);
    const client = new Listener(boardUrl(b.url, boardId));
    await client.open();
    await new Promise((resolve) => setTimeout(resolve, 300));

    const response = await announce(
      a.url,
      boardId,
      {
        event: 'close',
        voting: {
          ...voting,
          status: 'closed',
          closedAt: '2026-10-11T10:05:00Z',
          placed: undefined,
          result: [{ elementId: 'e1', count: 2 }],
        },
      },
      `Bearer ${await serviceToken()}`,
    );

    expect(response.status).toBe(204);
    await waitUntil(() => client.received.length === 1);
    client.close();
    await Promise.all([a.app.close(), b.app.close()]);
  });

  it('does not send it to another board', async () => {
    const store = new InMemoryDocumentStore();
    const boardId = randomUUID();
    const a = await startInstance(store, slowSaves);
    const other = new Listener(boardUrl(a.url, randomUUID()));
    await other.open();

    await announce(a.url, boardId, { event: 'start', voting }, `Bearer ${await serviceToken()}`);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(other.received).toEqual([]);
    other.close();
    await a.app.close();
  });

  it('refuses a call without a valid service token (401) and does not send anything', async () => {
    const store = new InMemoryDocumentStore();
    const boardId = randomUUID();
    const a = await startInstance(store, slowSaves);
    const client = new Listener(boardUrl(a.url, boardId));
    await client.open();
    const now = Math.floor(Date.now() / 1000);
    const bad = [
      undefined,
      'Bearer nonsense',
      `Bearer ${await serviceToken({ exp: now - 120 })}`,
      `Bearer ${await serviceToken({ aud: 'elysion-backend-internal' })}`,
      `Bearer ${await serviceToken({ iss: 'elysion-realtime' })}`,
      `Bearer ${await serviceToken({ secret: 'another-secret-of-thirty-two-characters-or-more' })}`,
      `Bearer ${await serviceToken({ exp: now + 3600 })}`,
    ];

    for (const authorization of bad) {
      expect(
        (await announce(a.url, boardId, { event: 'start', voting }, authorization)).status,
      ).toBe(401);
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(client.received).toEqual([]);
    client.close();
    await a.app.close();
  });

  it('refuses a board id that is no UUID and a body that is not a voting notification (400)', async () => {
    const a = await startInstance(new InMemoryDocumentStore(), slowSaves);
    const authorization = `Bearer ${await serviceToken()}`;

    expect(
      (await announce(a.url, 'not-a-uuid', { event: 'start', voting }, authorization)).status,
    ).toBe(400);
    expect(
      (await announce(a.url, randomUUID(), { event: 'explode', voting }, authorization)).status,
    ).toBe(400);
    expect(
      (await announce(a.url, randomUUID(), { event: 'vote', voting: null }, authorization)).status,
    ).toBe(400);
    await a.app.close();
  });

  it('ignores a voting message that a client sends', async () => {
    const store = new InMemoryDocumentStore();
    const boardId = randomUUID();
    const a = await startInstance(store, slowSaves);
    const sender = new Listener(boardUrl(a.url, boardId));
    const other = new Listener(boardUrl(a.url, boardId, { sub: 'o' }));
    await Promise.all([sender.open(), other.open()]);

    sender.send(new Uint8Array([MESSAGE_VOTING, 2, 123, 125]));
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(other.received).toEqual([]);
    sender.close();
    other.close();
    await a.app.close();
  });
});
