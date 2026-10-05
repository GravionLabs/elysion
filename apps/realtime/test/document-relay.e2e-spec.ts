import * as Y from 'yjs';
import { InMemoryDocumentStore } from '../src/persistence/in-memory-document-store.js';
import { SyncClient, startInstance, waitUntil } from './helpers.js';
import { boardUrl } from './ws-token.js';

/**
 * Two realtime instances on one Valkey (REDIS_URL, by default the shared local-infra Valkey) serve the same
 * board to clients on different instances. The store is shared too, as the business backend is in production.
 */
describe('Document relay across realtime instances (e2e)', () => {
  const slowSaves = { saveDebounceMs: 60_000, saveMaxWaitMs: 60_000, evictAfterMs: 60_000 };

  it('shows a drawing made through one instance to a client connected to the other', async () => {
    const store = new InMemoryDocumentStore();
    const boardId = `relay-${Date.now()}`;
    const instanceA = await startInstance(store, slowSaves);
    const instanceB = await startInstance(store, slowSaves);
    const clientA = new SyncClient(boardUrl(instanceA.url, boardId));
    const clientB = new SyncClient(boardUrl(instanceB.url, boardId));
    await Promise.all([clientA.waitForOpen(), clientB.waitForOpen()]);
    await new Promise((resolve) => setTimeout(resolve, 300)); // both rooms follow the relay

    clientA.doc.getMap('elements').set('rect', 'drawn through A');
    await waitUntil(() => clientB.doc.getMap('elements').has('rect'));
    clientB.doc.getMap('elements').set('arrow', 'drawn through B');
    await waitUntil(() => clientA.doc.getMap('elements').has('arrow'));

    expect(clientA.doc.getMap('elements').toJSON()).toEqual(
      clientB.doc.getMap('elements').toJSON(),
    );
    clientA.close();
    clientB.close();
    await Promise.all([instanceA.app.close(), instanceB.app.close()]);
  });

  it('catches an instance up on changes that are not in the store yet when it opens the board later', async () => {
    const store = new InMemoryDocumentStore();
    const boardId = `relay-late-${Date.now()}`;
    const instanceA = await startInstance(store, slowSaves);
    const clientA = new SyncClient(boardUrl(instanceA.url, boardId));
    await clientA.waitForOpen();
    clientA.doc.getMap('elements').set('rect', 'unsaved so far');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(store.documents.has(boardId)).toBe(false);

    const instanceB = await startInstance(store, slowSaves);
    const clientB = new SyncClient(boardUrl(instanceB.url, boardId));
    await clientB.waitForOpen();
    await waitUntil(() => clientB.doc.getMap('elements').has('rect'));

    expect(clientB.doc.getMap('elements').get('rect')).toBe('unsaved so far');
    clientA.close();
    clientB.close();
    await Promise.all([instanceA.app.close(), instanceB.app.close()]);
  });

  it('does not duplicate or loop: a change arrives once and the clients converge', async () => {
    const store = new InMemoryDocumentStore();
    const boardId = `relay-once-${Date.now()}`;
    const instanceA = await startInstance(store, slowSaves);
    const instanceB = await startInstance(store, slowSaves);
    const clientA = new SyncClient(boardUrl(instanceA.url, boardId));
    const clientB = new SyncClient(boardUrl(instanceB.url, boardId));
    await Promise.all([clientA.waitForOpen(), clientB.waitForOpen()]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    let updatesAtB = 0;
    clientB.doc.on('update', () => updatesAtB++);

    clientA.doc.getMap('elements').set('rect', 1);
    await waitUntil(() => clientB.doc.getMap('elements').has('rect'));
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(updatesAtB).toBe(1);
    expect(Y.encodeStateVector(clientA.doc)).toEqual(Y.encodeStateVector(clientB.doc));
    clientA.close();
    clientB.close();
    await Promise.all([instanceA.app.close(), instanceB.app.close()]);
  });
});
