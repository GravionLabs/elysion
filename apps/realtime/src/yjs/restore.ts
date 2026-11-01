import { randomInt } from 'node:crypto';
import * as Y from 'yjs';

const ELEMENTS_KEY = 'elements';
const FILES_KEY = 'files';

type StoredElement = Record<string, unknown> & {
  version?: number;
  versionNonce?: number;
  isDeleted?: boolean;
};

export interface RestoreResult {
  /** Elements written with the content of the version. */
  restored: number;
  /** Live elements that the version does not have, marked deleted. */
  removed: number;
}

const isElement = (value: unknown): value is StoredElement =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const versionOf = (element: StoredElement | undefined): number =>
  typeof element?.version === 'number' ? element.version : 0;

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (isElement(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
}

/** Whether two elements are the same except for the fields that change with every write. */
function sameContent(a: StoredElement, b: StoredElement): boolean {
  const strip = (element: StoredElement) => {
    const { version, versionNonce, updated, ...rest } = element;
    void version;
    void versionNonce;
    void updated;
    return rest;
  };
  return JSON.stringify(sortKeys(strip(a))) === JSON.stringify(sortKeys(strip(b)));
}

/**
 * Restores a version by **merging forward** (ADR 0032): the difference between the live document and the version is
 * written into the live document as one ordinary transaction. Every element of the version is written with its content
 * and a version above the live one; every live element the version lacks is marked `isDeleted` with a higher version.
 * `files` only gains the references the version has (an image is never removed from the store). `session` and `meta` are
 * not touched. Because the written versions are above everything a client holds, a client that comes back with an old
 * copy cannot bring the old content back by reconciling it.
 *
 * `origin` goes to the transaction, so the caller can tell the update from a client's.
 */
export function restoreSnapshot(
  doc: Y.Doc,
  snapshotState: Uint8Array,
  origin: unknown,
): RestoreResult {
  const snapshot = new Y.Doc();
  try {
    Y.applyUpdate(snapshot, snapshotState);
    const wanted = snapshot.getMap<unknown>(ELEMENTS_KEY);
    const live = doc.getMap<unknown>(ELEMENTS_KEY);
    const result: RestoreResult = { restored: 0, removed: 0 };
    const now = Date.now();

    doc.transact(() => {
      for (const [id, value] of wanted.entries()) {
        if (!isElement(value)) continue;
        const current = live.get(id);
        const currentElement = isElement(current) ? current : undefined;
        if (currentElement ? sameContent(currentElement, value) : value.isDeleted === true)
          continue;
        live.set(id, {
          ...value,
          version: Math.max(versionOf(value), versionOf(currentElement)) + 1,
          versionNonce: randomInt(1, 2 ** 31 - 1),
          updated: now,
        });
        result.restored += 1;
      }
      const lacking = live.toJSON() as Record<string, unknown>;
      for (const [id, value] of Object.entries(lacking)) {
        if (wanted.has(id) || !isElement(value) || value.isDeleted === true) continue;
        live.set(id, {
          ...value,
          isDeleted: true,
          version: versionOf(value) + 1,
          versionNonce: randomInt(1, 2 ** 31 - 1),
          updated: now,
        });
        result.removed += 1;
      }
      const files = doc.getMap<unknown>(FILES_KEY);
      for (const [id, reference] of snapshot.getMap<unknown>(FILES_KEY).entries()) {
        if (!files.has(id)) files.set(id, reference);
      }
    }, origin);
    return result;
  } finally {
    snapshot.destroy();
  }
}
