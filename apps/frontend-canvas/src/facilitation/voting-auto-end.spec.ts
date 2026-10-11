import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { presentVoterIds, publishVoter, watchAllVoted } from './voting-auto-end';

/** Two clients that hear of each other's awareness states. */
function pair() {
  const a = new Awareness(new Y.Doc());
  const b = new Awareness(new Y.Doc());
  const relay = (from: Awareness, to: Awareness) =>
    from.on(
      'update',
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) =>
        applyAwarenessUpdate(
          to,
          encodeAwarenessUpdate(from, [...added, ...updated, ...removed]),
          'remote',
        ),
    );
  relay(a, b);
  relay(b, a);
  return { a, b };
}

const OPEN = { id: 'v1', votesPerPerson: 2 };

describe('who is present to vote', () => {
  it('lists each person once, even on two tabs', () => {
    const { a, b } = pair();
    publishVoter(a, { id: 'u1' });
    publishVoter(b, { id: 'u1' });

    expect(presentVoterIds(a)).toEqual(['u1']);
  });
});

describe('closing a voting once everybody present has voted', () => {
  const watches: Array<{ destroy(): void }> = [];
  afterEach(() => watches.splice(0).forEach((w) => w.destroy()));

  const watch = (awareness: Awareness, canClose = true) => {
    const close = vi.fn();
    const w = watchAllVoted(
      awareness,
      () => OPEN,
      () => canClose,
      close,
    );
    watches.push(w);
    return { close, w };
  };

  it('closes when everybody present placed all their votes', () => {
    const { a, b } = pair();
    const { close } = watch(a);
    publishVoter(a, { id: 'u1', votingId: 'v1', votes: 2 });
    publishVoter(b, { id: 'u2', votingId: 'v1', votes: 2 });

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('waits for somebody who has votes left, a viewer too', () => {
    const { a, b } = pair();
    const { close } = watch(a);
    publishVoter(b, { id: 'u2', votingId: 'v1', votes: 1 });
    publishVoter(a, { id: 'u1', votingId: 'v1', votes: 2 });

    expect(close).not.toHaveBeenCalled();
  });

  it('does not count votes of another voting', () => {
    const { a } = pair();
    const { close } = watch(a);
    publishVoter(a, { id: 'u1', votingId: 'old', votes: 2 });

    expect(close).not.toHaveBeenCalled();
  });

  it('is left to those who may close it', () => {
    const { a } = pair();
    const { close } = watch(a, false);
    publishVoter(a, { id: 'u1', votingId: 'v1', votes: 2 });

    expect(close).not.toHaveBeenCalled();
  });

  it('asks only once for the same voting', () => {
    const { a, b } = pair();
    const { close, w } = watch(a);
    publishVoter(a, { id: 'u1', votingId: 'v1', votes: 2 });
    w.check();
    w.check();
    publishVoter(b, { id: 'u2', votingId: 'v1', votes: 2 });

    expect(close).toHaveBeenCalledTimes(1);
  });
});
