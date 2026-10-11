/**
 * What the canvas keeps on this device so that work survives an outage (#735, `apps/frontend-canvas/src/yjs/offline-work.ts`): IndexedDB
 * databases named `elysion-board:<boardId>:<generation>`, listed in `elysion.offline-stores` of the local storage. They hold the
 * content of boards, so the shell removes them when the person logs out: the next one on the same device finds nothing.
 */
const DB_PREFIX = 'elysion-board:';
const INDEX_KEY = 'elysion.offline-stores';

function indexed(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((name): name is string => typeof name === 'string') : [];
  } catch {
    return [];
  }
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Deletes every offline store of every board; never fails (a browser without IndexedDB has none). */
export async function clearOfflineStores(): Promise<void> {
  const names = new Set(indexed());
  try {
    for (const database of (await indexedDB.databases?.()) ?? []) {
      if (database.name?.startsWith(DB_PREFIX)) names.add(database.name);
    }
  } catch {
    // Not listable here: the index has them.
  }
  await Promise.all([...names].map(deleteDatabase));
  try {
    localStorage.removeItem(INDEX_KEY);
  } catch {
    // Blocked storage: nothing to remove.
  }
}
