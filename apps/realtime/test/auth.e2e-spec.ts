import { InMemoryDocumentStore } from '../src/persistence/in-memory-document-store.js';
import { SyncClient, startInstance, waitUntil } from './helpers.js';
import { boardUrl, signWsToken } from './ws-token.js';

/**
 * The `/yjs` handshake needs a WS token for exactly the board that is opened (docs/specs/identity.md).
 * A refused connection is closed with 4401 (no usable token) or 4403 (a token for another board).
 */
describe('WS token at the handshake (e2e)', () => {
  let app: Awaited<ReturnType<typeof startInstance>>['app'];
  let url: string;
  const store = new InMemoryDocumentStore();
  const board = () => `auth-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  beforeAll(async () => {
    ({ app, url } = await startInstance(store));
  });

  afterAll(async () => {
    await app.close();
  });

  const closeCodeOf = async (target: string): Promise<number> => {
    const client = new SyncClient(target);
    client.waitForOpen().catch(() => undefined);
    return client.closed;
  };

  it('rejects a connection without a token', async () => {
    const id = board();

    expect(await closeCodeOf(`${url}?board=${id}`)).toBe(4401);
  });

  it('rejects an empty or malformed token', async () => {
    const id = board();

    expect(await closeCodeOf(`${url}?board=${id}&token=`)).toBe(4401);
    expect(await closeCodeOf(`${url}?board=${id}&token=not-a-jwt`)).toBe(4401);
  });

  it('rejects an expired token', async () => {
    const id = board();

    expect(await closeCodeOf(boardUrl(url, id, { expiresIn: -60 }))).toBe(4401);
  });

  it('rejects a token signed with another secret', async () => {
    const id = board();

    const code = await closeCodeOf(
      boardUrl(url, id, { secret: 'another-secret-that-is-at-least-32-characters' }),
    );

    expect(code).toBe(4401);
  });

  it('rejects a token with a role that does not exist', async () => {
    const id = board();

    expect(await closeCodeOf(boardUrl(url, id, { role: 'admin' }))).toBe(4401);
  });

  it('rejects a valid token for a different board: it must not open every board', async () => {
    const target = board();
    const other = board();

    const code = await closeCodeOf(`${url}?board=${target}&token=${signWsToken(other)}`);

    expect(code).toBe(4403);
  });

  it('does not load or store a board for a refused connection', async () => {
    const id = board();

    await closeCodeOf(`${url}?board=${id}`);
    await closeCodeOf(`${url}?board=${id}&token=${signWsToken('somewhere-else')}`);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(store.documents.has(id)).toBe(false);
  });

  it('syncs a document as before for a valid token', async () => {
    const id = board();
    const writer = new SyncClient(boardUrl(url, id, { role: 'owner' }));
    const reader = new SyncClient(boardUrl(url, id, { sub: 'kc-sub-2', role: 'viewer' }));
    await Promise.all([writer.waitForOpen(), reader.waitForOpen()]);

    writer.doc.getMap('elements').set('rect-1', { type: 'rectangle' });

    await waitUntil(() => reader.doc.getMap('elements').has('rect-1'));
    expect(reader.doc.getMap('elements').get('rect-1')).toEqual({ type: 'rectangle' });
    writer.close();
    reader.close();
  });

  it('lets every role in: the role is bound for later work, the gate only checks the token', async () => {
    for (const role of ['owner', 'editor', 'viewer']) {
      const client = new SyncClient(boardUrl(url, board(), { role }));
      await client.waitForOpen();
      await new Promise((resolve) => setTimeout(resolve, 50));
      client.close();
      expect(await client.closed).toBe(1005);
    }
  });
});
