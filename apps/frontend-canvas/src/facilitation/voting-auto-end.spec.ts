import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { afterEach, describe, expect, it } from 'vitest';
import { type Voter, presentVoterIds, publishVoter, watchAllVoted } from './voting-auto-end';
import { castVote, readVoting, startSession } from './voting';

const ADA = { id: 'u-ada', name: 'Ada' };

/** One client: a document and an awareness, with what the realtime service does between them. */
function client(doc = new Y.Doc()) {
  const awareness = new Awareness(doc);
  return { doc, awareness };
}

/** Two clients that hear of each other's document changes and awareness states. */
function pair() {
  const a = client();
  const b = client();
  a.doc.on('update', (update: Uint8Array) => Y.applyUpdate(b.doc, update));
  b.doc.on('update', (update: Uint8Array) => Y.applyUpdate(a.doc, update));
  const relay = (from: Awareness, to: Awareness) =>
    from.on(
      'update',
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
        const changed = [...added, ...updated, ...removed];
        applyAwarenessUpdate(to, encodeAwarenessUpdate(from, changed), 'remote');
      },
    );
  relay(a.awareness, b.awareness);
  relay(b.awareness, a.awareness);
  return { a, b };
}

const open = (doc: Y.Doc, votes = 2) => startSession(doc, { votesPerPerson: votes }, ADA);
const status = (doc: Y.Doc) => readVoting(doc).sessions[0]?.status;
const voter = (id: string, canVote = true): Voter => ({ id, canVote });

describe('who is present to vote', () => {
  const watches: Array<{ destroy(): void }> = [];
  afterEach(() => watches.splice(0).forEach((w) => w.destroy()));

  it('lists the people who may vote, once each, and leaves out viewers and anybody who said nothing', () => {
    const { a, b } = pair();
    publishVoter(a.awareness, voter('u-ada'));
    publishVoter(b.awareness, voter('u-bea', false)); // a viewer
    const third = client();
    publishVoter(third.awareness, voter('u-ada')); // a second tab of Ada
    applyAwarenessUpdate(
      a.awareness,
      encodeAwarenessUpdate(third.awareness, [third.awareness.clientID]),
      'remote',
    );
    const silent = client();
    silent.awareness.setLocalState({ user: { id: 'x' } });
    applyAwarenessUpdate(
      a.awareness,
      encodeAwarenessUpdate(silent.awareness, [silent.awareness.clientID]),
      'remote',
    );

    expect(presentVoterIds(a.awareness)).toEqual(['u-ada']);
    expect(presentVoterIds(b.awareness)).toEqual(['u-ada']);
  });

  it('ends the voting when the only person present has used all their votes', () => {
    const { a } = pair();
    publishVoter(a.awareness, voter('u-ada'));
    watches.push(watchAllVoted(a.doc, a.awareness, () => true));
    const { id } = open(a.doc, 2);

    castVote(a.doc, id, 'u-ada', 'e1');
    expect(status(a.doc)).toBe('open');
    castVote(a.doc, id, 'u-ada', 'e2');

    expect(status(a.doc)).toBe('closed');
    expect(readVoting(a.doc).openSessionId).toBeNull();
  });

  it('waits for everybody present: not before the last of them has voted', () => {
    const { a, b } = pair();
    publishVoter(a.awareness, voter('u-ada'));
    publishVoter(b.awareness, voter('u-bea'));
    watches.push(watchAllVoted(a.doc, a.awareness, () => true));
    watches.push(watchAllVoted(b.doc, b.awareness, () => true));
    const { id } = open(a.doc, 1);

    castVote(a.doc, id, 'u-ada', 'e1');
    expect(status(b.doc)).toBe('open');
    castVote(b.doc, id, 'u-bea', 'e1');

    expect(status(a.doc)).toBe('closed');
    expect(status(b.doc)).toBe('closed');
  });

  it('does not wait for a viewer, and a viewer does not end it', () => {
    const { a, b } = pair();
    publishVoter(a.awareness, voter('u-ada'));
    publishVoter(b.awareness, voter('u-viewer', false));
    watches.push(watchAllVoted(b.doc, b.awareness, () => false)); // the viewer's client cannot write
    watches.push(watchAllVoted(a.doc, a.awareness, () => true));
    const { id } = open(a.doc, 1);

    castVote(a.doc, id, 'u-ada', 'e1');

    expect(status(a.doc)).toBe('closed'); // ended by the one who may write
  });

  it('stays open when only viewers are present: nobody can end it but the facilitator', () => {
    const { a } = pair();
    publishVoter(a.awareness, voter('u-viewer', false));
    watches.push(watchAllVoted(a.doc, a.awareness, () => false));
    open(a.doc, 1);

    expect(status(a.doc)).toBe('open');
  });

  it('does not end a voting nobody has voted in', () => {
    const { a } = pair();
    publishVoter(a.awareness, voter('u-ada'));
    watches.push(watchAllVoted(a.doc, a.awareness, () => true));

    open(a.doc, 1);

    expect(status(a.doc)).toBe('open');
  });

  it('ends when the person who still had votes left leaves the board', () => {
    const { a, b } = pair();
    publishVoter(a.awareness, voter('u-ada'));
    publishVoter(b.awareness, voter('u-bea'));
    watches.push(watchAllVoted(a.doc, a.awareness, () => true));
    const { id } = open(a.doc, 1);
    castVote(a.doc, id, 'u-ada', 'e1');
    expect(status(a.doc)).toBe('open'); // Bea has not voted

    b.awareness.setLocalState(null); // she leaves

    expect(status(a.doc)).toBe('closed');
  });

  it('ends when a person who had votes left becomes a viewer', () => {
    const { a } = pair();
    publishVoter(a.awareness, voter('u-ada'));
    const second = client();
    publishVoter(second.awareness, voter('u-bea'));
    applyAwarenessUpdate(
      a.awareness,
      encodeAwarenessUpdate(second.awareness, [second.awareness.clientID]),
      'remote',
    );
    const watch = watchAllVoted(a.doc, a.awareness, () => true);
    watches.push(watch);
    const { id } = open(a.doc, 1);
    castVote(a.doc, id, 'u-ada', 'e1');
    expect(status(a.doc)).toBe('open');

    publishVoter(second.awareness, voter('u-bea', false));
    applyAwarenessUpdate(
      a.awareness,
      encodeAwarenessUpdate(second.awareness, [second.awareness.clientID]),
      'remote',
    );

    expect(status(a.doc)).toBe('closed');
  });

  it('is harmless when two clients end it in the same moment, and when it is checked again', () => {
    const { a, b } = pair();
    publishVoter(a.awareness, voter('u-ada'));
    publishVoter(b.awareness, voter('u-ada')); // the same person in two tabs
    const first = watchAllVoted(a.doc, a.awareness, () => true);
    const second = watchAllVoted(b.doc, b.awareness, () => true);
    watches.push(first, second);
    const { id } = open(a.doc, 1);

    castVote(a.doc, id, 'u-ada', 'e1');
    first.check();
    second.check();

    expect(readVoting(a.doc).sessions).toHaveLength(1);
    expect(status(b.doc)).toBe('closed');
  });

  it('stops watching when destroyed', () => {
    const { a } = pair();
    publishVoter(a.awareness, voter('u-ada'));
    const watch = watchAllVoted(a.doc, a.awareness, () => true);
    const { id } = open(a.doc, 1);
    watch.destroy();

    castVote(a.doc, id, 'u-ada', 'e1');

    expect(status(a.doc)).toBe('open');
  });
});
