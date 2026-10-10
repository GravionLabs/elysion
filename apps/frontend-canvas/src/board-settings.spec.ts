import * as Y from 'yjs';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GRID,
  META_MAP_KEY,
  observeGrid,
  parseGrid,
  readGrid,
  writeGrid,
} from './board-settings';

describe('the grid of a board', () => {
  it('is shown, snapped to and 20 px for a board that has no setting', () => {
    expect(DEFAULT_GRID).toEqual({ show: true, snap: true, size: 20, guides: true });
    expect(readGrid(new Y.Doc())).toEqual(DEFAULT_GRID);
  });

  it('takes what is valid from a stored value and the default for the rest', () => {
    expect(parseGrid({ show: false, snap: false, size: 40, guides: false })).toEqual({
      show: false,
      snap: false,
      size: 40,
      guides: false,
    });
    // A board from before the guides has no `guides`: they are on.
    expect(parseGrid({ show: false, snap: false, size: 40 })).toEqual({
      show: false,
      snap: false,
      size: 40,
      guides: true,
    });
    expect(parseGrid({ show: 'no', snap: 0, size: 33, guides: 'yes' })).toEqual(DEFAULT_GRID);
    expect(parseGrid({ show: false })).toEqual({ ...DEFAULT_GRID, show: false });
    for (const odd of [null, undefined, 3, 'grid', []])
      expect(parseGrid(odd)).toEqual(DEFAULT_GRID);
  });

  it('is written as one object under meta.grid, and read by another client', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.on('update', (update: Uint8Array) => Y.applyUpdate(b, update));

    writeGrid(a, { size: 10 });
    writeGrid(a, { show: false });

    expect(a.getMap(META_MAP_KEY).get('grid')).toEqual({
      show: false,
      snap: true,
      size: 10,
      guides: true,
    });
    expect(readGrid(b)).toEqual({ show: false, snap: true, size: 10, guides: true });
  });

  it('sends nothing when nothing changes, and does not write on read', () => {
    const doc = new Y.Doc();
    const update = vi.fn();
    doc.on('update', update);

    readGrid(doc);
    writeGrid(doc, {});
    writeGrid(doc, { show: true, snap: true, size: 20, guides: true }); // the default, still no setting

    expect(update).not.toHaveBeenCalled();
    writeGrid(doc, { snap: false });
    expect(update).toHaveBeenCalledTimes(1);
    writeGrid(doc, { snap: false });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('is announced when it changes, here or elsewhere, and not for another key of meta', () => {
    const doc = new Y.Doc();
    const seen: unknown[] = [];
    const stop = observeGrid(doc, (grid) => seen.push(grid));

    doc.getMap(META_MAP_KEY).set('generation', 2);
    writeGrid(doc, { size: 40 });
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc)); // another client that has seen the change, and changes it again
    remote.getMap(META_MAP_KEY).set('grid', { show: false, snap: true, size: 40, guides: true });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));
    stop();
    writeGrid(doc, { size: 10 });

    expect(seen).toEqual([
      { show: true, snap: true, size: 40, guides: true },
      { show: false, snap: true, size: 40, guides: true },
    ]);
  });
});
