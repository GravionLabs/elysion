import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearOfflineStores } from './offline-data';

describe('clearOfflineStores', () => {
  const deleted: string[] = [];
  let real: IDBFactory | undefined;

  beforeEach(() => {
    deleted.length = 0;
    localStorage.clear();
    real = globalThis.indexedDB;
    globalThis.indexedDB = {
      databases: vi.fn(async () => [
        { name: 'elysion-board:b1:g1' },
        { name: 'something-else' },
        { name: 'elysion-board:b2:-' },
      ]),
      deleteDatabase: vi.fn((name: string) => {
        deleted.push(name);
        const request: { onsuccess?: () => void } = {};
        queueMicrotask(() => request.onsuccess?.());
        return request;
      }),
    } as unknown as IDBFactory;
  });

  afterEach(() => {
    globalThis.indexedDB = real as IDBFactory;
  });

  it('deletes the stores of every board, those the browser lists and those the index knows, and nothing else', async () => {
    localStorage.setItem('elysion.offline-stores', JSON.stringify(['elysion-board:b3:g9']));

    await clearOfflineStores();

    expect(deleted.sort()).toEqual([
      'elysion-board:b1:g1',
      'elysion-board:b2:-',
      'elysion-board:b3:g9',
    ]);
    expect(localStorage.getItem('elysion.offline-stores')).toBeNull();
  });

  it('does not fail where IndexedDB cannot list its databases or is not there', async () => {
    globalThis.indexedDB = { databases: undefined } as unknown as IDBFactory;
    await expect(clearOfflineStores()).resolves.toBeUndefined();

    // @ts-expect-error a browser without it
    delete globalThis.indexedDB;
    await expect(clearOfflineStores()).resolves.toBeUndefined();
  });
});
