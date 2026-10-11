import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OfflineWork,
  type OfflineState,
  clearAllOfflineStores,
  resetIndexedDbProbe,
  storeName,
} from './offline-work';

const SERVER = { server: true };

async function databases(): Promise<string[]> {
  return ((await indexedDB.databases()) ?? [])
    .map((database) => database.name ?? '')
    .filter((name) => name.startsWith('elysion-board:'));
}

const open: OfflineWork[] = [];
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function make(overrides: { boardId?: string; canWrite?: boolean; doc?: Y.Doc } = {}) {
  const doc = overrides.doc ?? new Y.Doc();
  const states: OfflineState[] = [];
  const discarded = vi.fn();
  const work = new OfflineWork({
    doc,
    boardId: overrides.boardId ?? 'b1',
    serverOrigin: () => SERVER,
    canWrite: () => overrides.canWrite ?? true,
    onChange: (state) => states.push(state),
    onDiscarded: discarded,
    clearDelayMs: 10,
    now: () => 1000,
  });
  open.push(work);
  return { doc, work, states, discarded };
}

describe('OfflineWork', () => {
  beforeEach(async () => {
    for (const work of open.splice(0)) work.destroy();
    localStorage.clear();
    resetIndexedDbProbe();
    await clearAllOfflineStores();
  });

  afterEach(async () => {
    for (const work of open.splice(0)) work.destroy(); // closes the databases, so they can be deleted
    await settle();
    await clearAllOfflineStores();
  });

  it('keeps nothing before the board was loaded once', async () => {
    const { work, states } = make();

    work.disconnected();
    await settle();

    expect(states).toEqual([]);
    expect(await databases()).toEqual([]);
  });

  it('reports the outage and counts the changes made during it, not those of the server', async () => {
    const { doc, work, states } = make();
    await work.synced('g1');

    work.disconnected();
    doc.getMap('elements').set('a', 1);
    doc.transact(() => doc.getMap('elements').set('b', 2), SERVER);
    doc.getMap('elements').set('c', 3);

    expect(states[0]).toEqual({ offline: true, since: 1000, pending: 0, sent: 0 });
    expect(work.pending).toBe(2);
    expect(states.at(-1)).toMatchObject({ offline: true, pending: 2 });
  });

  it('stores the document while offline, and a tab opened later gets it back after the first sync', async () => {
    const first = make();
    await first.work.synced('g1');
    first.work.disconnected();
    first.doc.getMap('elements').set('sticky', 'Hello');
    await settle();
    expect(await databases()).toEqual([storeName('b1', 'g1')]);
    first.work.destroy(); // the tab is closed

    const second = make();
    await second.work.synced('g1');

    expect(second.doc.getMap('elements').get('sticky')).toBe('Hello');
    expect(second.discarded).not.toHaveBeenCalled();
  });

  it('applies the restored changes as changes of this device, so the sync client sends them', async () => {
    const first = make();
    await first.work.synced('g1');
    first.work.disconnected();
    first.doc.getMap('elements').set('x', 1);
    await settle();
    first.work.destroy();

    const doc = new Y.Doc();
    const origins: unknown[] = [];
    doc.on('update', (_update: Uint8Array, origin: unknown) => origins.push(origin));
    const second = make({ doc });
    await second.work.synced('g1');

    expect(origins.length).toBeGreaterThan(0);
    expect(origins).not.toContain(SERVER);
  });

  it('reports the way back with the number of changes sent, and removes the store', async () => {
    const { doc, work, states } = make();
    await work.synced('g1');
    work.disconnected();
    doc.getMap('elements').set('a', 1);
    doc.getMap('elements').set('b', 1);
    await settle();

    await work.synced('g1');

    expect(states.at(-1)).toEqual({ offline: false, since: null, pending: 0, sent: 2 });
    await vi.waitFor(async () => expect(await databases()).toEqual([]));
    expect(localStorage.getItem('elysion.offline-stores')).toBeNull();
  });

  it('keeps the store when the connection breaks again before it was removed', async () => {
    const { doc, work } = make();
    await work.synced('g1');
    work.disconnected();
    await settle();
    await work.synced('g1');
    work.disconnected(); // before the delay is over
    doc.getMap('elements').set('late', 1);
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(await databases()).toEqual([storeName('b1', 'g1')]);
  });

  it('throws away the store of another generation, with a message, and does not apply it', async () => {
    const first = make();
    await first.work.synced('g1');
    first.work.disconnected();
    first.doc.getMap('elements').set('old', 1);
    await settle();
    first.work.destroy();

    const second = make();
    await second.work.synced('g2');

    expect(second.doc.getMap('elements').get('old')).toBeUndefined();
    expect(second.discarded).toHaveBeenCalledTimes(1);
    expect(await databases()).toEqual([]);
  });

  it('leaves the stores of other boards alone', async () => {
    const other = make({ boardId: 'other' });
    await other.work.synced('g1');
    other.work.disconnected();
    other.doc.getMap('elements').set('x', 1);
    await settle();
    other.work.destroy();

    const mine = make();
    await mine.work.synced('g9');

    expect(await databases()).toEqual([storeName('other', 'g1')]);
    expect(mine.discarded).not.toHaveBeenCalled();
  });

  it('stores nothing for a canvas that cannot write', async () => {
    const { doc, work } = make({ canWrite: false });
    await work.synced('g1');
    work.disconnected();
    doc.getMap('session').set('x', 1);
    await settle();

    expect(await databases()).toEqual([]);
  });

  it('forgets the stores of a board whose document is out of date', async () => {
    const { doc, work } = make();
    await work.synced('g1');
    work.disconnected();
    doc.getMap('elements').set('a', 1);
    await settle();

    await work.stale();

    await vi.waitFor(async () => expect(await databases()).toEqual([]));
    expect(localStorage.getItem('elysion.offline-stores')).toBeNull();
  });

  it('works as before when IndexedDB cannot be used', async () => {
    const real = globalThis.indexedDB;
    // @ts-expect-error a browser without it
    delete globalThis.indexedDB;
    resetIndexedDbProbe();
    try {
      const { doc, work, states } = make();
      await work.synced('g1');
      work.disconnected();
      doc.getMap('elements').set('a', 1);
      await settle();

      expect(states.at(-1)).toMatchObject({ offline: true, pending: 1 });
    } finally {
      globalThis.indexedDB = real;
      resetIndexedDbProbe();
    }
  });

  it('clears every store of the browser, for the logout', async () => {
    for (const id of ['b1', 'b2']) {
      const { doc, work } = make({ boardId: id });
      await work.synced('g1');
      work.disconnected();
      doc.getMap('elements').set('a', 1);
      await settle();
      work.destroy();
    }
    expect((await databases()).length).toBe(2);

    await clearAllOfflineStores();

    expect(await databases()).toEqual([]);
    expect(localStorage.getItem('elysion.offline-stores')).toBeNull();
  });
});
