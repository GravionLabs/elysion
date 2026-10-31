import * as Y from 'yjs';
import { restoreSnapshot } from './restore.js';

const rect = (id: string, version: number, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'rectangle',
  x: 0,
  y: 0,
  version,
  versionNonce: 7,
  updated: 1,
  isDeleted: false,
  ...extra,
});

function docOf(
  elements: Record<string, unknown>,
  files: Record<string, unknown> = {},
  session: Record<string, unknown> = {},
): Y.Doc {
  const doc = new Y.Doc();
  for (const [id, value] of Object.entries(elements)) doc.getMap('elements').set(id, value);
  for (const [id, value] of Object.entries(files)) doc.getMap('files').set(id, value);
  for (const [id, value] of Object.entries(session)) doc.getMap('session').set(id, value);
  return doc;
}

const stateOf = (doc: Y.Doc) => Y.encodeStateAsUpdate(doc);
const element = (doc: Y.Doc, id: string) =>
  doc.getMap('elements').get(id) as Record<string, unknown> & { version: number };

describe('restoreSnapshot', () => {
  it('writes the content of the version with a version above the live one', () => {
    const live = docOf({ a: rect('a', 9, { x: 500 }) });
    const snapshot = stateOf(docOf({ a: rect('a', 2, { x: 10 }) }));

    const result = restoreSnapshot(live, snapshot, 'origin');

    expect(element(live, 'a')).toMatchObject({ x: 10, isDeleted: false, version: 10 });
    expect(result).toEqual({ restored: 1, removed: 0 });
  });

  it('marks live elements that the version lacks as deleted, with a higher version', () => {
    const live = docOf({ a: rect('a', 3), b: rect('b', 4) });
    const snapshot = stateOf(docOf({ a: rect('a', 3) }));

    const result = restoreSnapshot(live, snapshot, 'origin');

    expect(element(live, 'b')).toMatchObject({ isDeleted: true, version: 5 });
    expect(element(live, 'a').version).toBe(3);
    expect(result).toEqual({ restored: 0, removed: 1 });
  });

  it('brings back an element that was deleted after the version', () => {
    const live = docOf({ a: rect('a', 6, { isDeleted: true }) });
    const snapshot = stateOf(docOf({ a: rect('a', 2) }));

    restoreSnapshot(live, snapshot, 'origin');

    expect(element(live, 'a')).toMatchObject({ isDeleted: false, version: 7 });
  });

  it('writes a tombstone over an element the version had deleted, and skips tombstones the board never had', () => {
    const live = docOf({ a: rect('a', 1) });
    const snapshot = stateOf(
      docOf({ a: rect('a', 4, { isDeleted: true }), ghost: rect('ghost', 1, { isDeleted: true }) }),
    );

    restoreSnapshot(live, snapshot, 'origin');

    expect(element(live, 'a')).toMatchObject({ isDeleted: true, version: 5 });
    expect(live.getMap('elements').has('ghost')).toBe(false);
  });

  it('leaves an unchanged board as it is', () => {
    const live = docOf({ a: rect('a', 3) });
    const snapshot = stateOf(docOf({ a: rect('a', 1, { version: 99 }) }));
    const updates: Uint8Array[] = [];
    live.on('update', (update: Uint8Array) => updates.push(update));

    expect(restoreSnapshot(live, snapshot, 'origin')).toEqual({ restored: 0, removed: 0 });
    expect(updates.length).toBeLessThanOrEqual(1);
    expect(element(live, 'a').version).toBe(3);
  });

  it('adds the files of the version but keeps the session and the files the board has', () => {
    const live = docOf({}, { new: { mimeType: 'image/png' } }, { timer: { state: 'running' } });
    const snapshot = stateOf(
      docOf({}, { old: { mimeType: 'image/jpeg' } }, { timer: { state: 'stopped' } }),
    );

    restoreSnapshot(live, snapshot, 'origin');

    expect(Object.keys(live.getMap('files').toJSON()).sort()).toEqual(['new', 'old']);
    expect(live.getMap('session').toJSON()).toEqual({ timer: { state: 'running' } });
  });

  it('applies everything as one update with the given origin', () => {
    const live = docOf({ a: rect('a', 1), b: rect('b', 1) });
    const snapshot = stateOf(docOf({ a: rect('a', 1, { x: 5 }) }));
    const origins: unknown[] = [];
    live.on('update', (_update: Uint8Array, origin: unknown) => origins.push(origin));

    restoreSnapshot(live, snapshot, 'restore-origin');

    expect(origins).toEqual(['restore-origin']);
  });

  it('does not let an old copy of the board win after the restore', () => {
    // A client held {a: v3, x: 500} offline; the board is restored to {a: v2, x: 10} meanwhile.
    const live = docOf({ a: rect('a', 3, { x: 500 }) });
    const offline = new Y.Doc();
    Y.applyUpdate(offline, stateOf(live));
    restoreSnapshot(live, stateOf(docOf({ a: rect('a', 2, { x: 10 }) })), 'origin');

    Y.applyUpdate(live, stateOf(offline));

    expect(element(live, 'a')).toMatchObject({ x: 10, version: 4 });
  });
});
