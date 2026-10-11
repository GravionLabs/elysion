import { describe, expect, it } from 'vitest';
import { type ApiVoting, NO_VOTING, elementLabel, snapshotOf, tally } from './voting';

const note = (id: string, text: string, extra = {}) => ({ id, type: 'text', text, ...extra });

describe('elementLabel', () => {
  it('uses the text of a text element, clipped', () => {
    expect(elementLabel(note('a', '  Hello \n world '), [])).toBe('Hello world');
    expect(elementLabel(note('a', 'x'.repeat(100)), []).length).toBe(58);
  });

  it('uses the text bound to a shape, else the type', () => {
    const text = note('t', 'Idea');
    const shape = { id: 's', type: 'rectangle', boundElements: [{ id: 't', type: 'text' }] };
    expect(elementLabel(shape, [shape, text])).toBe('Idea');
    expect(elementLabel({ id: 'r', type: 'ellipse' }, [])).toBe('ellipse');
  });
});

describe('tally', () => {
  const elements = [note('a', 'Alpha'), note('b', 'Beta'), note('c', 'Gamma', { isDeleted: true })];

  it('ranks by count, then label, and leaves out deleted and unknown elements', () => {
    const result = [
      { elementId: 'b', count: 2 },
      { elementId: 'a', count: 2 },
      { elementId: 'c', count: 9 },
      { elementId: 'gone', count: 4 },
    ];

    expect(tally(result, elements)).toEqual([
      { elementId: 'a', count: 2, label: 'Alpha' },
      { elementId: 'b', count: 2, label: 'Beta' },
    ]);
  });

  it('keeps the voters of a named voting', () => {
    const voters = [{ id: 'u1', name: 'Ada' }];

    expect(tally([{ elementId: 'a', count: 1, voters }], elements)[0].voters).toEqual(voters);
  });
});

describe('snapshotOf', () => {
  const base: ApiVoting = {
    id: 'v1',
    name: 'Pick',
    votesPerPerson: 3,
    status: 'open',
    named: false,
    startedBy: { id: 'u1', name: 'Ada' },
    myVotes: 2,
    myElementVotes: { a: 2 },
  };

  it('is empty without a voting', () => {
    expect(snapshotOf(null, [])).toBe(NO_VOTING);
  });

  it('shows an open voting with the own dots and no result', () => {
    const snapshot = snapshotOf({ ...base, result: [{ elementId: 'a', count: 5 }] }, []);

    expect(snapshot.openSessionId).toBe('v1');
    expect(snapshot.own).toEqual({ a: 2 });
    expect(snapshot.view).toMatchObject({ status: 'open', myVotes: 2, named: false });
    expect(snapshot.view?.tally).toBeUndefined();
  });

  it('shows a closed voting with its tally and no dots', () => {
    const closed: ApiVoting = {
      ...base,
      status: 'closed',
      result: [{ elementId: 'a', count: 5 }],
    };

    const snapshot = snapshotOf(closed, [note('a', 'Alpha')]);

    expect(snapshot.openSessionId).toBeNull();
    expect(snapshot.own).toEqual({});
    expect(snapshot.view?.tally).toEqual([{ elementId: 'a', count: 5, label: 'Alpha' }]);
  });
});
