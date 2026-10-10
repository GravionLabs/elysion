import { InMemoryDocumentStore } from '../src/persistence/in-memory-document-store.js';
import { SyncClient, startInstance, waitUntil } from './helpers.js';
import { boardUrl } from './ws-token.js';

/**
 * ADR 0026 over real sockets: a board that was dragged around for a long time is rebuilt when the last client has left,
 * and a client that comes back with a copy of the old document is told so (4409) and not merged into the new one.
 */
describe('compaction and generations (e2e)', () => {
  let app: Awaited<ReturnType<typeof startInstance>>['app'];
  let url: string;
  const store = new InMemoryDocumentStore();
  const board = () => `compact-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  beforeAll(async () => {
    ({ app, url } = await startInstance(store, {
      compactAboveBytes: 20_000,
      evictAfterMs: 200,
      saveDebounceMs: 20,
    }));
  });

  afterAll(async () => {
    await app.close();
  });

  async function dragAround(id: string): Promise<void> {
    const client = new SyncClient(boardUrl(url, id));
    await client.waitForOpen();
    const elements = client.doc.getMap<unknown>('elements');
    for (let i = 0; i < 3_000; i++) {
      elements.set(`e${i % 50}`, { id: `e${i % 50}`, x: i, y: i * 2, version: i });
    }
    await waitUntil(() => store.documents.has(id), 5000);
    await new Promise((resolve) => setTimeout(resolve, 100));
    client.close();
    await client.closed;
  }

  const generationOf = async (id: string): Promise<string | undefined> => {
    const reader = new SyncClient(boardUrl(url, id));
    await reader.waitForOpen();
    await waitUntil(() => reader.doc.getMap('elements').size > 0);
    const generation = reader.doc.getMap('meta').get('generation') as string | undefined;
    reader.close();
    await reader.closed;
    return generation;
  };

  it('rebuilds a long-edited board when everybody has left, and keeps its elements', async () => {
    const id = board();
    await dragAround(id);
    const before = store.documents.get(id)!.state.length;

    await waitUntil(() => (store.documents.get(id)?.state.length ?? before) < before / 2, 8000);

    const reader = new SyncClient(boardUrl(url, id));
    await reader.waitForOpen();
    await waitUntil(() => reader.doc.getMap('elements').size === 50);
    expect(reader.doc.getMap('meta').get('generation')).toMatch(/^[0-9a-f-]{36}$/);
    reader.close();
  });

  it('closes a client that holds the generation from before the rebuild with 4409, and takes a new one', async () => {
    const id = board();
    await dragAround(id);
    await waitUntil(() => (store.documents.get(id)?.state.length ?? 1e9) < 20_000, 8000);
    const current = await generationOf(id);

    const stale = new SyncClient(`${boardUrl(url, id)}&generation=${encodeURIComponent('')}`);
    stale.waitForOpen().catch(() => undefined);
    expect(await stale.closed).toBe(4409);

    const fresh = new SyncClient(
      `${boardUrl(url, id)}&generation=${encodeURIComponent(current ?? '')}`,
    );
    await fresh.waitForOpen();
    await waitUntil(() => fresh.doc.getMap('elements').size === 50);
    fresh.close();
  });

  it('refuses an update over the size of one update with 1009', async () => {
    const id = board();
    const client = new SyncClient(boardUrl(url, id));
    await client.waitForOpen();

    client.doc.getMap('elements').set('huge', 'x'.repeat(3 * 1024 * 1024));

    expect(await client.closed).toBe(1009);
  });
});
