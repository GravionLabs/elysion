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

  it('opens one socket per token: the same token a second time is refused with 4401 (#772)', async () => {
    const id = board();
    const target = boardUrl(url, id, { jti: `jti-${Math.random().toString(36).slice(2)}` });
    const first = new SyncClient(target);
    await first.waitForOpen();

    const second = new SyncClient(target);
    second.waitForOpen().catch(() => undefined);

    expect(await second.closed).toBe(4401);
    first.close();
  });

  it('lets a token without an id in, as one of a BFF that predates the rule', async () => {
    const id = board();
    const target = boardUrl(url, id);
    const first = new SyncClient(target);
    const second = new SyncClient(target);

    await Promise.all([first.waitForOpen(), second.waitForOpen()]);

    first.close();
    second.close();
  });

  describe('viewers are read-only', () => {
    it("does not let a viewer's edit reach an editor, but the editor's edit reaches the viewer", async () => {
      const id = board();
      const editor = new SyncClient(boardUrl(url, id, { sub: 'ed', role: 'editor' }));
      const viewer = new SyncClient(boardUrl(url, id, { sub: 'vi', role: 'viewer' }));
      await Promise.all([editor.waitForOpen(), viewer.waitForOpen()]);

      viewer.doc.getMap('elements').set('from-viewer', { type: 'rectangle' });
      editor.doc.getMap('elements').set('from-editor', { type: 'ellipse' });

      await waitUntil(() => viewer.doc.getMap('elements').has('from-editor'));
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(editor.doc.getMap('elements').has('from-viewer')).toBe(false);
      expect(viewer.doc.getMap('elements').has('from-editor')).toBe(true);
      editor.close();
      viewer.close();
    });

    it("keeps a viewer's edit out of the stored board", async () => {
      const id = board();
      const editor = new SyncClient(boardUrl(url, id, { sub: 'ed', role: 'editor' }));
      const viewer = new SyncClient(boardUrl(url, id, { sub: 'vi', role: 'viewer' }));
      await Promise.all([editor.waitForOpen(), viewer.waitForOpen()]);
      editor.doc.getMap('elements').set('kept', 1);
      viewer.doc.getMap('elements').set('dropped', 1);
      await new Promise((resolve) => setTimeout(resolve, 200));
      editor.close();
      viewer.close();
      await waitUntil(() => store.documents.has(id));

      const reader = new SyncClient(boardUrl(url, id, { sub: 'ed2', role: 'owner' }));
      await reader.waitForOpen();
      await waitUntil(() => reader.doc.getMap('elements').has('kept'));

      expect(reader.doc.getMap('elements').has('dropped')).toBe(false);
      reader.close();
    });

    it('lets a viewer open a board that already has content', async () => {
      const id = board();
      const owner = new SyncClient(boardUrl(url, id, { role: 'owner' }));
      await owner.waitForOpen();
      owner.doc.getMap('elements').set('rect-1', { type: 'rectangle' });
      await new Promise((resolve) => setTimeout(resolve, 150));

      const viewer = new SyncClient(boardUrl(url, id, { sub: 'vi', role: 'viewer' }));
      await viewer.waitForOpen();

      await waitUntil(() => viewer.doc.getMap('elements').has('rect-1'));
      owner.close();
      viewer.close();
    });
  });
});
