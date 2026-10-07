import * as Y from 'yjs';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SESSION_NAME,
  MAX_SESSION_NAME_LENGTH,
  type VotableElement,
  castVote,
  clearResults,
  currentSession,
  elementLabel,
  endSession,
  ownVotesByElement,
  readVoting,
  retractVote,
  startSession,
  tally,
  viewFor,
  votesLeft,
} from './voting';
import { observeVoting } from './voting-sync';

const ADA = { id: 'u-ada', name: 'Ada' };
const T0 = 1_000_000;
const el = (id: string, extra: Partial<VotableElement> = {}): VotableElement => ({
  id,
  type: 'rectangle',
  ...extra,
});

/** Two documents that exchange every update, as the realtime service lets two clients do. */
function peers() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on('update', (update: Uint8Array) => Y.applyUpdate(b, update));
  b.on('update', (update: Uint8Array) => Y.applyUpdate(a, update));
  return { a, b };
}

const open = (doc = new Y.Doc(), votesPerPerson = 3) => {
  const session = startSession(doc, { name: 'Pick', votesPerPerson }, ADA, T0);
  return { doc, id: session.id };
};

describe('starting a session', () => {
  it('opens a session with the name, the votes per person and who started it', () => {
    const doc = new Y.Doc();

    const session = startSession(doc, { name: '  Best idea  ', votesPerPerson: 5 }, ADA, T0);

    expect(session).toMatchObject({
      name: 'Best idea',
      votesPerPerson: 5,
      status: 'open',
      startedBy: ADA,
      startedAt: T0,
      closedAt: null,
      votes: {},
    });
    expect(readVoting(doc).openSessionId).toBe(session.id);
  });

  it('names an unnamed session "Voting" and cuts a name that is too long', () => {
    const doc = new Y.Doc();
    expect(startSession(doc, { votesPerPerson: 3 }, ADA).name).toBe(DEFAULT_SESSION_NAME);

    const other = new Y.Doc();
    const long = startSession(other, { name: 'x'.repeat(500), votesPerPerson: 3 }, ADA);
    expect(long.name).toHaveLength(MAX_SESSION_NAME_LENGTH);
  });

  it.each([0, -1, 1.5, 101, Number.NaN])('refuses %s votes per person', (votes) => {
    expect(() => startSession(new Y.Doc(), { votesPerPerson: votes }, ADA)).toThrow(RangeError);
  });

  it('refuses a second session while one is open, and allows one after it was closed', () => {
    const { doc, id } = open();

    expect(() => startSession(doc, { votesPerPerson: 3 }, ADA)).toThrow('already open');
    endSession(doc, id);
    const next = startSession(doc, { name: 'Second', votesPerPerson: 3 }, ADA, T0 + 10);

    expect(readVoting(doc).sessions.map((s) => s.name)).toEqual(['Pick', 'Second']);
    expect(readVoting(doc).openSessionId).toBe(next.id);
  });

  it('is read by everybody on the board', () => {
    const { a, b } = peers();

    const session = startSession(a, { name: 'Pick', votesPerPerson: 3 }, ADA, T0);

    expect(readVoting(b).sessions).toEqual([session]);
  });

  it('is outside the elements and next to the timer', () => {
    const { doc } = open();

    expect(doc.getMap('session').has('voting')).toBe(true);
    expect(doc.getMap('elements').size).toBe(0);
  });
});

describe('voting', () => {
  it('counts each vote on an element, several on the same one', () => {
    const { doc, id } = open(undefined, 5);

    expect(castVote(doc, id, 'u1', 'e1')).toBe('voted');
    expect(castVote(doc, id, 'u1', 'e1')).toBe('voted');
    expect(castVote(doc, id, 'u1', 'e2')).toBe('voted');

    const session = readVoting(doc).sessions[0];
    expect(session.votes['u1']).toEqual(['e1', 'e1', 'e2']);
    expect(ownVotesByElement(session, 'u1')).toEqual({ e1: 2, e2: 1 });
    expect(votesLeft(session, 'u1')).toBe(2);
  });

  it('refuses a vote past the limit, for that person only', () => {
    const { doc, id } = open(undefined, 2);
    castVote(doc, id, 'u1', 'e1');
    castVote(doc, id, 'u1', 'e2');

    expect(castVote(doc, id, 'u1', 'e3')).toBe('no-votes-left');
    expect(castVote(doc, id, 'u2', 'e3')).toBe('voted');
    expect(readVoting(doc).sessions[0].votes['u1']).toEqual(['e1', 'e2']);
  });

  it('refuses a vote in a closed or an unknown session', () => {
    const { doc, id } = open();
    endSession(doc, id);

    expect(castVote(doc, id, 'u1', 'e1')).toBe('closed');
    expect(castVote(doc, 'nope', 'u1', 'e1')).toBe('unknown-session');
    expect(castVote(new Y.Doc(), id, 'u1', 'e1')).toBe('unknown-session');
  });

  it('takes one vote back at a time, and gives the vote back', () => {
    const { doc, id } = open(undefined, 2);
    castVote(doc, id, 'u1', 'e1');
    castVote(doc, id, 'u1', 'e1');

    expect(retractVote(doc, id, 'u1', 'e1')).toBe(true);
    expect(readVoting(doc).sessions[0].votes['u1']).toEqual(['e1']);
    expect(castVote(doc, id, 'u1', 'e2')).toBe('voted'); // the limit counts what is placed now
  });

  it('retracts nothing that is not there, and nothing from somebody else, and nothing once closed', () => {
    const { doc, id } = open();
    castVote(doc, id, 'u1', 'e1');

    expect(retractVote(doc, id, 'u1', 'e2')).toBe(false);
    expect(retractVote(doc, id, 'u2', 'e1')).toBe(false);
    expect(retractVote(doc, 'nope', 'u1', 'e1')).toBe(false);
    endSession(doc, id);
    expect(retractVote(doc, id, 'u1', 'e1')).toBe(false);
    expect(readVoting(doc).sessions[0].votes['u1']).toEqual(['e1']);
  });

  it('keeps both votes when two people vote at the same moment, before they have seen each other', () => {
    const a = new Y.Doc();
    const { id } = open(a, 3);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    // Neither document hears of the other: both vote (also for the first vote of a person).
    castVote(a, id, 'u-a', 'e1');
    castVote(b, id, 'u-b', 'e1');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    for (const doc of [a, b]) {
      const votes = readVoting(doc).sessions[0].votes;
      expect(votes['u-a']).toEqual(['e1']);
      expect(votes['u-b']).toEqual(['e1']);
    }
  });
});

describe('ending and clearing', () => {
  it('closes the session for everybody: no open session, a close time', () => {
    const { a, b } = peers();
    const { id } = open(a);

    expect(endSession(b, id, T0 + 50)).toBe(true);

    expect(readVoting(a).openSessionId).toBeNull();
    expect(readVoting(a).sessions[0]).toMatchObject({ status: 'closed', closedAt: T0 + 50 });
    expect(endSession(a, id)).toBe(false); // twice is the same as once
    expect(endSession(a, 'nope')).toBe(false);
  });

  it('removes a session with its votes, an open one too', () => {
    const { doc, id } = open();
    castVote(doc, id, 'u1', 'e1');

    expect(clearResults(doc, id)).toBe(true);

    expect(readVoting(doc)).toEqual({ sessions: [], openSessionId: null });
    expect(clearResults(doc, id)).toBe(false);
    expect(startSession(doc, { votesPerPerson: 3 }, ADA).status).toBe('open'); // and a new one can start
  });

  it('shows the open session, else the one closed last, else none', () => {
    const doc = new Y.Doc();
    expect(currentSession(readVoting(doc))).toBeNull();

    const first = startSession(doc, { name: 'One', votesPerPerson: 1 }, ADA, T0);
    expect(currentSession(readVoting(doc))?.id).toBe(first.id);
    endSession(doc, first.id, T0 + 10);
    const second = startSession(doc, { name: 'Two', votesPerPerson: 1 }, ADA, T0 + 20);
    expect(currentSession(readVoting(doc))?.id).toBe(second.id);
    endSession(doc, second.id, T0 + 30);
    expect(currentSession(readVoting(doc))?.name).toBe('Two');
    clearResults(doc, second.id);
    expect(currentSession(readVoting(doc))?.name).toBe('One');
  });

  it('treats something in the map that is not a session as no session', () => {
    const doc = new Y.Doc();
    open(doc);
    (doc.getMap('session').get('voting') as Y.Map<Y.Map<unknown>>)
      .get('sessions')!
      .set('junk', 'not a session' as unknown as Y.Map<unknown>);

    expect(readVoting(doc).sessions).toHaveLength(1);
  });
});

describe('the tally', () => {
  const session = (votes: Record<string, string[]>) => ({
    ...startSession(new Y.Doc(), { votesPerPerson: 5 }, ADA),
    votes,
  });

  it('counts the votes per element, the most voted first', () => {
    const result = tally(session({ u1: ['a', 'b', 'b'], u2: ['b', 'c'], u3: ['c'] }), [
      el('a'),
      el('b'),
      el('c'),
    ]);

    expect(result.map((r) => [r.elementId, r.count])).toEqual([
      ['b', 3],
      ['c', 2],
      ['a', 1],
    ]);
  });

  it('breaks ties by label, then id, the same on every client', () => {
    const elements = [
      el('z', { type: 'text', text: 'Alpha' }),
      el('y', { type: 'text', text: 'Beta' }),
      el('x', { type: 'text', text: 'Beta' }),
    ];

    const result = tally(session({ u1: ['y', 'z', 'x'] }), elements);

    expect(result.map((r) => r.elementId)).toEqual(['z', 'x', 'y']);
  });

  it('leaves out elements that are deleted or gone, and counts them again when they come back', () => {
    const votes = { u1: ['a', 'b', 'gone'], u2: ['b'] };

    expect(
      tally(session(votes), [el('a'), el('b', { isDeleted: true })]).map((r) => r.elementId),
    ).toEqual(['a']);
    expect(tally(session(votes), [el('a'), el('b')]).map((r) => [r.elementId, r.count])).toEqual([
      ['b', 2],
      ['a', 1],
    ]);
  });

  it('names an element by its text, a sticky note by its bound text, else by its type', () => {
    const note = el('note', { boundElements: [{ id: 'label', type: 'text' }] });
    const label = el('label', { type: 'text', text: '  Ship\n it  ' });
    const all = [note, label, el('box'), el('long', { type: 'text', text: 'x'.repeat(100) })];

    expect(elementLabel(label, all)).toBe('Ship it');
    expect(elementLabel(note, all)).toBe('Ship it');
    expect(elementLabel(all[2], all)).toBe('rectangle');
    expect(elementLabel(all[3], all)).toHaveLength(58);
  });
});

describe('what the shell is told', () => {
  it('shows only the caller their own number of votes while open, and no tally', () => {
    const { doc, id } = open();
    castVote(doc, id, 'u1', 'e1');
    castVote(doc, id, 'u2', 'e1');
    castVote(doc, id, 'u2', 'e2');

    const view = viewFor(currentSession(readVoting(doc)), 'u1', [el('e1'), el('e2')])!;

    expect(view).toMatchObject({ id, name: 'Pick', votesPerPerson: 3, status: 'open', myVotes: 1 });
    expect(view.tally).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('u2');
  });

  it('adds the ranked counts once closed, still without names', () => {
    const { doc, id } = open();
    castVote(doc, id, 'u1', 'e1');
    castVote(doc, id, 'u2', 'e1');
    endSession(doc, id);

    const view = viewFor(currentSession(readVoting(doc)), 'u1', [el('e1')])!;

    expect(view.status).toBe('closed');
    expect(view.tally).toEqual([{ elementId: 'e1', count: 2, label: 'rectangle' }]);
    expect(JSON.stringify(view)).not.toContain('u2');
  });

  it('is nothing without a session', () => {
    expect(viewFor(null, 'u1', [])).toBeNull();
  });
});

describe('observing the voting', () => {
  it("announces a person's own votes, and does not announce what others vote while it is open", () => {
    const { a, b } = peers();
    const { id } = open(a);
    const seen = vi.fn();
    observeVoting(a, () => 'u1', seen);

    castVote(b, id, 'u2', 'e1'); // somebody else: nothing about it is shown to u1
    expect(seen).not.toHaveBeenCalled();

    castVote(b, id, 'u1', 'e1');
    expect(seen).toHaveBeenCalledTimes(1);
    const snapshot = seen.mock.calls[0][0];
    expect(snapshot.view.myVotes).toBe(1);
    expect(snapshot.own).toEqual({ e1: 1 });
    expect(snapshot.openSessionId).toBe(id);
  });

  it('announces a start, the end with the result, and a clear', () => {
    const doc = new Y.Doc();
    const seen = vi.fn();
    observeVoting(doc, () => 'u1', seen);

    const { id } = open(doc);
    expect(seen.mock.calls.at(-1)![0].view.status).toBe('open');
    castVote(doc, id, 'u1', 'e1');
    doc.getMap('elements').set('e1', { id: 'e1', type: 'rectangle', isDeleted: false });
    endSession(doc, id);
    const closed = seen.mock.calls.at(-1)![0];
    expect(closed.view.status).toBe('closed');
    expect(closed.view.tally).toEqual([{ elementId: 'e1', count: 1, label: 'rectangle' }]);
    expect(closed.own).toEqual({}); // no dots once closed

    clearResults(doc, id);
    expect(seen.mock.calls.at(-1)![0].view).toBeNull();
  });

  it('drops a deleted element from the result of a closed session', () => {
    const doc = new Y.Doc();
    const { id } = open(doc);
    doc.getMap('elements').set('e1', { id: 'e1', type: 'rectangle', isDeleted: false });
    castVote(doc, id, 'u1', 'e1');
    endSession(doc, id);
    const seen = vi.fn();
    observeVoting(doc, () => 'u1', seen);

    doc.getMap('elements').set('e1', { id: 'e1', type: 'rectangle', isDeleted: true });

    expect(seen.mock.calls.at(-1)![0].view.tally).toEqual([]);
  });

  it('says it again on request, and stops when destroyed', () => {
    const doc = new Y.Doc();
    const seen = vi.fn();
    const sync = observeVoting(doc, () => 'u1', seen);

    sync.emit();
    expect(seen).toHaveBeenCalledWith({ view: null, own: {}, openSessionId: null });

    sync.destroy();
    open(doc);
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
