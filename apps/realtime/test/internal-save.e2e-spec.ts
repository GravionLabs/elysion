import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import * as Y from 'yjs';
import { InMemoryDocumentStore } from '../src/persistence/in-memory-document-store.js';
import { SyncClient, startInstance, waitUntil } from './helpers.js';
import { boardUrl } from './ws-token.js';

/**
 * The business backend asks the realtime service to store a board now before it keeps a version of it (ADR 0032).
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

function httpOf(url: string): string {
  return url.replace('ws://', 'http://').replace('/yjs', '');
}

function save(instanceUrl: string, boardId: string, authorization?: string): Promise<Response> {
  return fetch(`${httpOf(instanceUrl)}/internal/boards/${boardId}/save`, {
    method: 'POST',
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe('Saving a board on request (e2e)', () => {
  it('stores the open board now instead of at the next debounce, and answers once it is stored', async () => {
    const store = new InMemoryDocumentStore();
    const boardId = randomUUID();
    const { app, url } = await startInstance(store, slowSaves);
    const client = new SyncClient(boardUrl(url, boardId));
    await client.waitForOpen();
    client.doc.getMap('elements').set('rect-1', { type: 'rectangle' });
    await new Promise((resolve) => setTimeout(resolve, 150)); // let the update reach the server
    expect(store.documents.has(boardId)).toBe(false);

    const response = await save(url, boardId, `Bearer ${await serviceToken()}`);

    expect(response.status).toBe(204);
    const stored = store.documents.get(boardId);
    expect(stored).toBeDefined();
    const doc = new Y.Doc();
    Y.applyUpdate(doc, stored!.state);
    expect(doc.getMap('elements').get('rect-1')).toEqual({ type: 'rectangle' });
    client.close();
    await app.close();
  });

  it('is a no-op for a board that is not open, and does not save twice when nothing changed', async () => {
    const store = new InMemoryDocumentStore();
    const boardId = randomUUID();
    const { app, url } = await startInstance(store, slowSaves);

    expect((await save(url, boardId, `Bearer ${await serviceToken()}`)).status).toBe(204);
    expect(store.documents.size).toBe(0);

    const client = new SyncClient(boardUrl(url, boardId));
    await client.waitForOpen();
    client.doc.getMap('elements').set('a', 1);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await save(url, boardId, `Bearer ${await serviceToken()}`);
    await waitUntil(() => store.documents.get(boardId)?.version === 1);
    await save(url, boardId, `Bearer ${await serviceToken()}`);

    expect(store.documents.get(boardId)?.version).toBe(1);
    client.close();
    await app.close();
  });

  it('refuses a call without a valid service token (401) and a board id that is no UUID (400)', async () => {
    const store = new InMemoryDocumentStore();
    const boardId = randomUUID();
    const { app, url } = await startInstance(store, slowSaves);
    const client = new SyncClient(boardUrl(url, boardId));
    await client.waitForOpen();
    client.doc.getMap('elements').set('a', 1);
    await new Promise((resolve) => setTimeout(resolve, 150));

    for (const authorization of [
      undefined,
      'Bearer nonsense',
      `Bearer ${await serviceToken('another-secret-of-thirty-two-characters-or-more')}`,
    ]) {
      expect((await save(url, boardId, authorization)).status).toBe(401);
    }
    expect((await save(url, 'not-a-uuid', `Bearer ${await serviceToken()}`)).status).toBe(400);

    expect(store.documents.has(boardId)).toBe(false);
    client.close();
    await app.close();
  });

  it('answers 503 when the store refuses the save, so the caller knows the stored state may lag', async () => {
    const store = new InMemoryDocumentStore();
    const boardId = randomUUID();
    const { app, url } = await startInstance(store, slowSaves);
    const client = new SyncClient(boardUrl(url, boardId));
    await client.waitForOpen();
    client.doc.getMap('elements').set('a', 1);
    await new Promise((resolve) => setTimeout(resolve, 150));
    vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('backend down'));

    expect((await save(url, boardId, `Bearer ${await serviceToken()}`)).status).toBe(503);

    client.close();
    await app.close();
  });
});
