import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  AGENDA_FILE_KEY,
  AGENDA_KEY,
  MAX_AGENDA_ITEMS,
  MAX_AGENDA_TITLE_LENGTH,
  addItem,
  agendaForFile,
  agendaFromFile,
  changeAgenda,
  currentItem,
  linkFrame,
  moveItem,
  nextItem,
  parseAgenda,
  plannedEnd,
  readAgenda,
  removeItem,
  renameItem,
  resetRun,
  runItem,
  runNext,
  setDuration,
  spentOn,
  startItem,
  totalMinutes,
  type AgendaItem,
} from './agenda';
import { SESSION_MAP_KEY, readTimer } from './timer';

const ADA = { id: 'u1', name: 'Ada' };
const T0 = 1_000_000;
const MIN = 60_000;

/** Three pending items: Intro 5, Ideas 20, Wrap-up 10. */
function plan(): AgendaItem[] {
  let items = addItem([], 'a', 'Intro', 5);
  items = addItem(items, 'b', 'Ideas', 20);
  return addItem(items, 'c', 'Wrap-up', 10);
}

describe('the agenda model', () => {
  it('adds pending items with a trimmed title and a whole number of minutes', () => {
    const items = addItem([], 'a', '  Intro  ', 4.6);
    expect(items).toEqual([
      {
        id: 'a',
        title: 'Intro',
        durationMin: 5,
        frameId: null,
        state: 'pending',
        spentMs: 0,
        startedAt: null,
      },
    ]);
  });

  it('cuts a title at 200 characters and refuses an empty one', () => {
    const long = 'x'.repeat(250);
    expect(addItem([], 'a', long)[0].title).toHaveLength(MAX_AGENDA_TITLE_LENGTH);
    expect(() => addItem([], 'a', '   ')).toThrow(RangeError);
    expect(() => renameItem(plan(), 'a', '')).toThrow(RangeError);
  });

  it('keeps a duration between 1 minute and a day', () => {
    expect(setDuration(plan(), 'a', 0)[0].durationMin).toBe(1);
    expect(setDuration(plan(), 'a', 5000)[0].durationMin).toBe(1440);
    expect(setDuration(plan(), 'a', 7)[0].durationMin).toBe(7);
  });

  it('refuses an item beyond the limit', () => {
    let items: AgendaItem[] = [];
    for (let i = 0; i < MAX_AGENDA_ITEMS; i++) items = addItem(items, `i${i}`, `Item ${i}`);
    expect(() => addItem(items, 'one-more', 'One more')).toThrow(RangeError);
  });

  it('renames, links a frame, unlinks it and deletes an item', () => {
    let items = renameItem(plan(), 'b', 'Brainstorm');
    items = linkFrame(items, 'b', 'frame-1');
    expect(items[1]).toMatchObject({ title: 'Brainstorm', frameId: 'frame-1' });
    expect(linkFrame(items, 'b', null)[1].frameId).toBeNull();
    expect(removeItem(items, 'b').map((item) => item.id)).toEqual(['a', 'c']);
  });

  it('reorders: to the front, to the end, beyond the ends, and an unknown id changes nothing', () => {
    const ids = (items: AgendaItem[]) => items.map((item) => item.id);
    expect(ids(moveItem(plan(), 'c', 0))).toEqual(['c', 'a', 'b']);
    expect(ids(moveItem(plan(), 'a', 2))).toEqual(['b', 'c', 'a']);
    expect(ids(moveItem(plan(), 'b', -3))).toEqual(['b', 'a', 'c']);
    expect(ids(moveItem(plan(), 'b', 99))).toEqual(['a', 'c', 'b']);
    expect(ids(moveItem(plan(), 'zz', 0))).toEqual(['a', 'b', 'c']);
  });

  it('sums the planned time', () => {
    expect(totalMinutes(plan())).toBe(35);
    expect(totalMinutes([])).toBe(0);
  });

  it('starts an item: it is current from now, and nothing else is', () => {
    const items = startItem(plan(), 'b', T0);
    expect(items.map((item) => item.state)).toEqual(['pending', 'current', 'pending']);
    expect(items[1].startedAt).toBe(T0);
    expect(currentItem(items)?.id).toBe('b');
  });

  it('starting another item finishes the current one and keeps its time', () => {
    let items = startItem(plan(), 'a', T0);
    items = startItem(items, 'c', T0 + 3 * MIN);
    expect(items[0]).toMatchObject({ state: 'done', spentMs: 3 * MIN, startedAt: null });
    expect(items[2]).toMatchObject({ state: 'current', startedAt: T0 + 3 * MIN });
  });

  it('starting the current item again changes nothing; an unknown one neither', () => {
    const items = startItem(plan(), 'a', T0);
    expect(startItem(items, 'a', T0 + MIN)).toEqual(items);
    expect(startItem(items, 'zz', T0 + MIN)).toEqual(items);
  });

  it('counts the time spent, adding up the runs of an item started again', () => {
    let items = startItem(plan(), 'a', T0);
    expect(spentOn(items[0], T0 + 2 * MIN)).toBe(2 * MIN);
    items = startItem(items, 'b', T0 + 2 * MIN);
    items = startItem(items, 'a', T0 + 10 * MIN);
    expect(spentOn(items[0], T0 + 11 * MIN)).toBe(3 * MIN);
    expect(spentOn(items[1], T0 + 11 * MIN)).toBe(8 * MIN);
    expect(spentOn(items[2], T0 + 11 * MIN)).toBe(0);
  });

  it('"Next" finishes the current item and starts the next pending one', () => {
    const started = startItem(plan(), 'a', T0);
    const { items, next } = nextItem(started, T0 + 4 * MIN);
    expect(next?.id).toBe('b');
    expect(items.map((item) => item.state)).toEqual(['done', 'current', 'pending']);
    expect(items[0].spentMs).toBe(4 * MIN);
    expect(items[1].startedAt).toBe(T0 + 4 * MIN);
  });

  it('"Next" skips what is done, starts the first item when none is current, and ends the agenda after the last', () => {
    expect(nextItem(plan(), T0).next?.id).toBe('a');

    let items = startItem(plan(), 'b', T0); // the facilitator began in the middle
    items = nextItem(items, T0 + MIN).items; // b done, c current
    const wrap = nextItem(items, T0 + 2 * MIN); // c done: a is the one left
    expect(wrap.next?.id).toBe('a');

    const end = nextItem(wrap.items, T0 + 3 * MIN);
    expect(end.next).toBeNull();
    expect(end.items.every((item) => item.state === 'done')).toBe(true);
  });

  it('plans the end from the current item and what is pending', () => {
    expect(plannedEnd(plan(), T0)).toBe(T0 + 35 * MIN);
    const items = startItem(plan(), 'a', T0);
    expect(plannedEnd(items, T0 + MIN)).toBe(T0 + 35 * MIN);
    // Running over: the current item ends no earlier than now.
    expect(plannedEnd(items, T0 + 8 * MIN)).toBe(T0 + 38 * MIN);
    const through = nextItem(nextItem(nextItem(items, T0).items, T0).items, T0).items;
    expect(plannedEnd(through, T0)).toBeNull();
  });

  it('resets a run: everything pending, no time spent', () => {
    const items = resetRun(nextItem(startItem(plan(), 'a', T0), T0 + MIN).items);
    expect(items.map((item) => [item.state, item.spentMs, item.startedAt])).toEqual([
      ['pending', 0, null],
      ['pending', 0, null],
      ['pending', 0, null],
    ]);
  });

  it('reads anything another client wrote without trusting it', () => {
    expect(parseAgenda(undefined)).toEqual([]);
    expect(parseAgenda({ items: 'no' })).toEqual([]);
    const items = parseAgenda({
      items: [
        { id: 'a', title: 'A', durationMin: 5, state: 'current', startedAt: T0, spentMs: 0 },
        { id: 'a', title: 'twice', durationMin: 5 },
        { id: 'b', title: 'B', durationMin: 5, state: 'current', startedAt: T0 },
        { id: 'c', title: 'C', durationMin: 5, state: 'current' },
        { id: 'd', title: 'D', durationMin: 'five' },
        { title: 'no id', durationMin: 5 },
        { id: 'e', title: 'E', durationMin: 5, state: 'weird', spentMs: -4, frameId: 7 },
        null,
      ],
    });
    expect(items.map((item) => [item.id, item.state])).toEqual([
      ['a', 'current'],
      ['b', 'pending'],
      ['c', 'pending'],
      ['e', 'pending'],
    ]);
    expect(items[3]).toMatchObject({ spentMs: 0, frameId: null });
  });
});

describe('the agenda in the document', () => {
  it('is a plain object under session.agenda, and an empty list removes the key', () => {
    const doc = new Y.Doc();
    changeAgenda(doc, () => plan());
    const stored = doc.getMap(SESSION_MAP_KEY).get(AGENDA_KEY) as { items: AgendaItem[] };
    expect(stored.items.map((item) => item.title)).toEqual(['Intro', 'Ideas', 'Wrap-up']);
    expect(readAgenda(doc)).toHaveLength(3);

    changeAgenda(doc, () => []);
    expect(doc.getMap(SESSION_MAP_KEY).has(AGENDA_KEY)).toBe(false);
  });

  it('starting an item starts the shared timer with its duration, in one transaction', () => {
    const doc = new Y.Doc();
    changeAgenda(doc, () => plan());
    let transactions = 0;
    doc.on('afterTransaction', () => transactions++);

    const started = runItem(doc, 'b', ADA, T0);

    expect(transactions).toBe(1);
    expect(started?.id).toBe('b');
    expect(currentItem(readAgenda(doc))?.id).toBe('b');
    expect(readTimer(doc)).toMatchObject({ durationMs: 20 * MIN, startedAt: T0, startedBy: ADA });
    expect(runItem(doc, 'zz', ADA, T0)).toBeNull();
  });

  it('"Next" runs the next item with its timer and stops the timer after the last', () => {
    const doc = new Y.Doc();
    changeAgenda(doc, () => plan());
    runItem(doc, 'b', ADA, T0);

    expect(runNext(doc, ADA, T0 + 5 * MIN)?.id).toBe('c');
    expect(readTimer(doc)).toMatchObject({ durationMs: 10 * MIN, startedAt: T0 + 5 * MIN });
    expect(readAgenda(doc)[1]).toMatchObject({ state: 'done', spentMs: 5 * MIN });

    expect(runNext(doc, ADA, T0 + 6 * MIN)?.id).toBe('a');
    expect(runNext(doc, ADA, T0 + 7 * MIN)).toBeNull();
    expect(readTimer(doc)).toBeNull();
  });

  it('syncs to a second document like the rest of the board', () => {
    const one = new Y.Doc();
    const two = new Y.Doc();
    one.on('update', (update: Uint8Array) => Y.applyUpdate(two, update));
    changeAgenda(one, () => plan());
    runItem(one, 'a', ADA, T0);
    expect(currentItem(readAgenda(two))?.title).toBe('Intro');
    expect(readTimer(two)?.durationMs).toBe(5 * MIN);
  });
});

describe('the agenda in a file (templates)', () => {
  it('carries the plan only, and comes back as a plan with nothing run', () => {
    const run = nextItem(startItem(linkFrame(plan(), 'a', 'f1'), 'a', T0), T0 + MIN).items;
    const file = JSON.stringify({ type: 'excalidraw', [AGENDA_FILE_KEY]: agendaForFile(run) });
    expect(JSON.parse(file)[AGENDA_FILE_KEY][0]).toEqual({
      id: 'a',
      title: 'Intro',
      durationMin: 5,
      frameId: 'f1',
    });
    const back = agendaFromFile(file);
    expect(back?.map((item) => [item.id, item.state, item.spentMs, item.frameId])).toEqual([
      ['a', 'pending', 0, 'f1'],
      ['b', 'pending', 0, null],
      ['c', 'pending', 0, null],
    ]);
  });

  it('is null for a file without an agenda or one that is not JSON', () => {
    expect(agendaFromFile(JSON.stringify({ type: 'excalidraw', elements: [] }))).toBeNull();
    expect(agendaFromFile('not json')).toBeNull();
    expect(agendaFromFile('null')).toBeNull();
  });
});
