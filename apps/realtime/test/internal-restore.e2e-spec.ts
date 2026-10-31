import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import * as Y from 'yjs';
import { InMemoryDocumentStore } from '../src/persistence/in-memory-document-store.js';
import { InMemorySnapshotSource } from '../src/persistence/snapshot-source.js';
import { SyncClient, startInstance, waitUntil } from './helpers.js';
import { boardUrl } from './ws-token.js';

/**
 * The business backend restores a version onto a board (ADR 0032, #847): the version is merged forward into the live
 * document, every client sees it without reconnecting and is told who did it.
 */
const INTERNAL_SECRET = 'test-only-internal-api-secret-0123456789abcdef';
const slowSaves = { saveDebounceMs: 60_000, saveMaxWaitMs: 60_000, evictAfterMs: 60_000 };

async function serviceToken(secret = INTERNAL_SECRET): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT()
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('elysion-business-backend')
    .setAudience('elysion-realtime')
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .sign(new TextEncoder().encode(secret));
}

const httpOf = (url: string) => url.replace('ws://', 'http://').replace('/yjs', '');

function restore(
  instanceUrl: string,
  boardId: string,
  body: unknown,
  authorization?: string,
): Promise<Response> {
  return fetch(`${httpOf(instanceUrl)}/internal/boards/${boardId}/restore`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authorization === undefined ? {} : { authorization }),
    },
    body: JSON.stringify(body),
  });
}

const rect = (id: string, version: number, x: number) => ({
  id,
  type: 'rectangle',
  x,
  version,
  versionNonce: 3,
  updated: 1,
  isDeleted: false,
});

function stateOf(elements: Record<string, unknown>): Uint8Array {
  const doc = new Y.Doc();
  for (const [id, value] of Object.entries(elements)) doc.getMap('elements').set(id, value);
  return Y.encodeStateAsUpdate(doc);
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
const xOf = (client: SyncClient, id: string) =>
  (client.doc.getMap('elements').get(id) as { x?: number; isDeleted?: boolean } | undefined)?.x;

describe('Restoring a version (e2e)', () => {
  it('puts every connected client on the restored state, announces it and stores it', async () => {
    const store = new InMemoryDocumentStore();
    const snapshots = new InMemorySnapshotSource();
    const boardId = randomUUID();
    const snapshotId = randomUUID();
    const { app, url } = await startInstance(store, slowSaves, undefined, undefined, snapshots);
    const ada = new SyncClient(boardUrl(url, boardId));
    const bob = new SyncClient(boardUrl(url, boardId, { sub: 'bob' }));
    await Promise.all([ada.waitForOpen(), bob.waitForOpen()]);
    ada.doc.getMap('elements').set('a', rect('a', 5, 500));
    ada.doc.getMap('elements').set('b', rect('b', 2, 20));
    await waitUntil(() => xOf(bob, 'b') === 20);
    snapshots.put(boardId, snapshotId, stateOf({ a: rect('a', 1, 10) }));

    const response = await restore(
      url,
      boardId,
      { snapshotId, by: 'Ada', at: '2026-10-31T10:00:00Z' },
      `Bearer ${await serviceToken()}`,
    );

    expect(response.status).toBe(204);
    await waitUntil(() => xOf(bob, 'a') === 10);
    expect(xOf(ada, 'a')).toBe(10);
    expect((bob.doc.getMap('elements').get('b') as { isDeleted: boolean }).isDeleted).toBe(true);
    await waitUntil(() => bob.restored.length === 1 && ada.restored.length === 1);
    expect(bob.restored[0]).toEqual({ snapshotId, by: 'Ada', at: '2026-10-31T10:00:00Z' });
    const stored = new Y.Doc();
    Y.applyUpdate(stored, store.documents.get(boardId)!.state);
    expect((stored.getMap('elements').get('a') as { x: number }).x).toBe(10);
    ada.close();
    bob.close();
    await app.close();
  });

  it('keeps the restored state when a client with an old copy of the board reconnects', async () => {
    const store = new InMemoryDocumentStore();
    const snapshots = new InMemorySnapshotSource();
    const boardId = randomUUID();
    const snapshotId = randomUUID();
    const { app, url } = await startInstance(store, slowSaves, undefined, undefined, snapshots);
    const ada = new SyncClient(boardUrl(url, boardId));
    await ada.waitForOpen();
    ada.doc.getMap('elements').set('a', rect('a', 5, 500));
    await settle();
    // Carol syncs the board, then goes offline.
    const carol = new SyncClient(boardUrl(url, boardId, { sub: 'carol' }));
    await carol.waitForOpen();
    await waitUntil(() => xOf(carol, 'a') === 500);
    const oldCopy = Y.encodeStateAsUpdate(carol.doc);
    carol.close();
    snapshots.put(boardId, snapshotId, stateOf({ a: rect('a', 1, 10) }));
    await restore(
      url,
      boardId,
      { snapshotId, by: 'Ada', at: '2026-10-31T10:00:00Z' },
      `Bearer ${await serviceToken()}`,
    );
    await waitUntil(() => xOf(ada, 'a') === 10);

    const returning = new SyncClient(boardUrl(url, boardId, { sub: 'carol' }));
    Y.applyUpdate(returning.doc, oldCopy);
    await returning.waitForOpen();
    await settle();

    expect(xOf(returning, 'a')).toBe(10);
    expect(xOf(ada, 'a')).toBe(10);
    returning.close();
    ada.close();
    await app.close();
  });

  it('restores a board nobody has open, into the store', async () => {
    const store = new InMemoryDocumentStore();
    const snapshots = new InMemorySnapshotSource();
    const boardId = randomUUID();
    const snapshotId = randomUUID();
    await store.save(boardId, stateOf({ a: rect('a', 5, 500) }), null);
    snapshots.put(boardId, snapshotId, stateOf({ a: rect('a', 1, 10) }));
    const { app, url } = await startInstance(store, slowSaves, undefined, undefined, snapshots);

    const response = await restore(
      url,
      boardId,
      { snapshotId, by: 'Ada', at: '2026-10-31T10:00:00Z' },
      `Bearer ${await serviceToken()}`,
    );

    expect(response.status).toBe(204);
    const stored = new Y.Doc();
    Y.applyUpdate(stored, store.documents.get(boardId)!.state);
    expect((stored.getMap('elements').get('a') as { x: number }).x).toBe(10);
    await app.close();
  });

  it('answers 404 for a version that is not there, 400 for a bad body and 401 without a service token', async () => {
    const store = new InMemoryDocumentStore();
    const boardId = randomUUID();
    const { app, url } = await startInstance(store, slowSaves);
    const good = { snapshotId: randomUUID(), by: 'Ada', at: '2026-10-31T10:00:00Z' };

    expect((await restore(url, boardId, good, `Bearer ${await serviceToken()}`)).status).toBe(404);
    expect(
      (await restore(url, boardId, { by: 'Ada' }, `Bearer ${await serviceToken()}`)).status,
    ).toBe(400);
    for (const authorization of [
      undefined,
      'Bearer nonsense',
      `Bearer ${await serviceToken('another-secret-of-thirty-two-characters-or-more')}`,
    ]) {
      expect((await restore(url, boardId, good, authorization)).status).toBe(401);
    }
    expect(store.documents.has(boardId)).toBe(false);
    await app.close();
  });
});
