import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { dayKey, formatSize, groupByDay, type SnapshotInfo } from './history';
import { liveElementsOf } from './snapshot-preview';

const snapshot = (id: string, createdAt: string): SnapshotInfo => ({
  id,
  kind: 'Manual',
  name: id,
  author: null,
  createdAt,
  sizeBytes: 10,
  elementCount: null,
});

const label = (day: 'today' | 'yesterday' | Date) =>
  day === 'today' ? 'Today' : day === 'yesterday' ? 'Yesterday' : `on ${dayKey(day)}`;

describe('groupByDay', () => {
  // Local noon, so that the day does not depend on the time zone of the machine.
  const now = new Date(2026, 9, 31, 12, 0, 0);
  const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0, 0).toISOString();

  it('groups by local day, newest day first and newest first inside a day', () => {
    const groups = groupByDay(
      [
        snapshot('old', at(20, 9)),
        snapshot('today-early', at(31, 8)),
        snapshot('yesterday', at(30, 23)),
        snapshot('today-late', at(31, 11)),
      ],
      now,
      label,
    );

    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ['Today', ['today-late', 'today-early']],
      ['Yesterday', ['yesterday']],
      ['on 2026-10-20', ['old']],
    ]);
  });

  it('is empty for no versions', () => {
    expect(groupByDay([], now, label)).toEqual([]);
  });

  it('knows yesterday across a month boundary', () => {
    const firstOfMonth = new Date(2026, 10, 1, 12, 0, 0);

    const groups = groupByDay(
      [snapshot('a', new Date(2026, 9, 31, 20).toISOString())],
      firstOfMonth,
      label,
    );

    expect(groups[0]?.label).toBe('Yesterday');
  });
});

describe('formatSize', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1 KB'],
    [12 * 1024 + 200, '12 KB'],
    [1.5 * 1024 * 1024, '1.5 MB'],
  ])('shows %d bytes as %s', (bytes, text) => {
    expect(formatSize(bytes)).toBe(text);
  });
});

describe('liveElementsOf', () => {
  it('returns the live elements of a stored state in index order and leaves out the deleted ones', () => {
    const doc = new Y.Doc();
    const elements = doc.getMap('elements');
    elements.set('b', { id: 'b', index: 'a2', isDeleted: false });
    elements.set('a', { id: 'a', index: 'a1', isDeleted: false });
    elements.set('gone', { id: 'gone', index: 'a0', isDeleted: true });
    const state = Y.encodeStateAsUpdate(doc);

    expect(liveElementsOf(state).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('returns nothing for an empty state', () => {
    expect(liveElementsOf(Y.encodeStateAsUpdate(new Y.Doc()))).toEqual([]);
  });
});
