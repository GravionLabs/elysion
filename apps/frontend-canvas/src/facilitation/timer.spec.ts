import * as Y from 'yjs';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_TIMER_MS,
  SESSION_MAP_KEY,
  TIMER_KEY,
  extendTimer,
  extended,
  hasEnded,
  parseTimer,
  pauseTimer,
  paused,
  readTimer,
  remaining,
  resumeTimer,
  resumed,
  startTimer,
  started,
  stopTimer,
} from './timer';
import { observeTimer } from './timer-sync';

const ADA = { id: 'u1', name: 'Ada' };
const T0 = 1_000_000;
const MIN = 60_000;

describe('the timer state functions (a frozen clock)', () => {
  it('starts with the whole duration left and counts down to zero', () => {
    const state = started(5 * MIN, ADA, T0);

    expect(remaining(state, T0)).toBe(5 * MIN);
    expect(remaining(state, T0 + 2 * MIN)).toBe(3 * MIN);
    expect(remaining(state, T0 + 5 * MIN)).toBe(0);
    expect(remaining(state, T0 + 9 * MIN)).toBe(0); // never below zero
    expect(state.startedBy).toEqual(ADA);
  });

  it('has ended only when it is running and at zero', () => {
    const state = started(MIN, ADA, T0);

    expect(hasEnded(state, T0 + MIN - 1)).toBe(false);
    expect(hasEnded(state, T0 + MIN)).toBe(true);
    expect(hasEnded(paused(state, T0 + 10), T0 + 5 * MIN)).toBe(false);
  });

  it('keeps what was left while it is paused and does not count the time paused', () => {
    const running = started(5 * MIN, ADA, T0);
    const stopped = paused(running, T0 + 2 * MIN);

    expect(stopped.pausedAt).toBe(T0 + 2 * MIN);
    expect(remaining(stopped, T0 + 2 * MIN)).toBe(3 * MIN);
    expect(remaining(stopped, T0 + 60 * MIN)).toBe(3 * MIN);

    const again = resumed(stopped, T0 + 10 * MIN);
    expect(again.pausedAt).toBeNull();
    expect(again.remainingAtPauseMs).toBeNull();
    expect(remaining(again, T0 + 10 * MIN)).toBe(3 * MIN);
    expect(remaining(again, T0 + 11 * MIN)).toBe(2 * MIN);
  });

  it('leaves a paused timer paused and a running timer running when asked for the same again', () => {
    const running = started(MIN, ADA, T0);
    const stopped = paused(running, T0 + 100);

    expect(resumed(running, T0 + 5)).toBe(running);
    expect(paused(stopped, T0 + 500)).toBe(stopped);
  });

  it('extends what is left, whether it runs, is paused or has just ended', () => {
    const running = started(2 * MIN, ADA, T0);

    expect(remaining(extended(running, MIN, T0 + MIN), T0 + MIN)).toBe(2 * MIN);
    expect(remaining(extended(paused(running, T0 + MIN), MIN, T0 + 5 * MIN), T0 + 9 * MIN)).toBe(
      2 * MIN,
    );
    // It ended 30 seconds ago: one more minute is one more minute from now, not from the old end.
    expect(remaining(extended(running, MIN, T0 + 2.5 * MIN), T0 + 2.5 * MIN)).toBe(MIN);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, MAX_TIMER_MS + 1])(
    'refuses a duration or an extension of %s',
    (ms) => {
      expect(() => started(ms, ADA, T0)).toThrow(RangeError);
      expect(() => extended(started(MIN, ADA, T0), ms, T0)).toThrow(RangeError);
    },
  );

  it('takes a value from the document only when it has the shape of a timer', () => {
    const good = started(MIN, ADA, T0);

    expect(parseTimer(JSON.parse(JSON.stringify(good)))).toEqual(good);
    expect(parseTimer(paused(good, T0 + 5))).toMatchObject({ pausedAt: T0 + 5 });
    for (const bad of [
      null,
      undefined,
      'timer',
      {},
      { ...good, durationMs: 'x' },
      { ...good, startedBy: null },
      { ...good, startedBy: { id: 1, name: 'x' } },
      { ...good, pausedAt: 5 }, // paused without the time that was left
    ]) {
      expect(parseTimer(bad)).toBeNull();
    }
  });
});

describe('the shared timer in a document', () => {
  const peers = () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    // What the realtime service does: every update of one reaches the other.
    a.on('update', (update: Uint8Array) => Y.applyUpdate(b, update));
    b.on('update', (update: Uint8Array) => Y.applyUpdate(a, update));
    return { a, b };
  };

  it('is none until somebody starts one, and a start is read by everybody', () => {
    const { a, b } = peers();
    expect(readTimer(a)).toBeNull();

    const state = startTimer(a, 5 * MIN, ADA, T0);

    expect(state.durationMs).toBe(5 * MIN);
    expect(readTimer(a)).toEqual(state);
    expect(readTimer(b)).toEqual(state);
  });

  it('lives in the map "session" under "timer", not in the elements', () => {
    const doc = new Y.Doc();
    startTimer(doc, MIN, ADA, T0);

    expect(doc.getMap(SESSION_MAP_KEY).has(TIMER_KEY)).toBe(true);
    expect(doc.getMap('elements').size).toBe(0);
  });

  it('pauses, resumes, extends and stops, each a change everybody sees', () => {
    const { a, b } = peers();
    startTimer(a, 5 * MIN, ADA, T0);

    pauseTimer(b, T0 + 2 * MIN);
    expect(remaining(readTimer(a)!, T0 + 50 * MIN)).toBe(3 * MIN);

    resumeTimer(a, T0 + 10 * MIN);
    expect(remaining(readTimer(b)!, T0 + 10 * MIN)).toBe(3 * MIN);

    extendTimer(b, MIN, T0 + 10 * MIN);
    expect(remaining(readTimer(a)!, T0 + 10 * MIN)).toBe(4 * MIN);

    stopTimer(a);
    expect(readTimer(a)).toBeNull();
    expect(readTimer(b)).toBeNull();
  });

  it('changes nothing when there is no timer, and stopping twice is the same as once', () => {
    const doc = new Y.Doc();

    expect(pauseTimer(doc, T0)).toBeNull();
    expect(resumeTimer(doc, T0)).toBeNull();
    expect(extendTimer(doc, MIN, T0)).toBeNull();
    stopTimer(doc);
    stopTimer(doc);
    expect(readTimer(doc)).toBeNull();
  });

  it('refuses a bad extension before it touches the document', () => {
    const doc = new Y.Doc();
    startTimer(doc, MIN, ADA, T0);
    const before = readTimer(doc);

    expect(() => extendTimer(doc, -5, T0)).toThrow(RangeError);
    expect(readTimer(doc)).toEqual(before);
  });

  it('starts a new timer over one that is there', () => {
    const doc = new Y.Doc();
    startTimer(doc, MIN, ADA, T0);

    startTimer(doc, 10 * MIN, { id: 'u2', name: 'Bea' }, T0 + 5);

    expect(readTimer(doc)).toMatchObject({ durationMs: 10 * MIN, startedBy: { name: 'Bea' } });
  });

  describe('observing it', () => {
    it('announces a change made here or by another peer, once per change', () => {
      const { a, b } = peers();
      const seen = vi.fn();
      observeTimer(b, seen);

      startTimer(a, MIN, ADA, T0);
      expect(seen).toHaveBeenCalledTimes(1);
      expect(seen.mock.calls[0][0]).toMatchObject({ durationMs: MIN });

      pauseTimer(b, T0 + 10);
      expect(seen).toHaveBeenCalledTimes(2);
      expect(seen.mock.calls[1][0]).toMatchObject({ pausedAt: T0 + 10 });

      stopTimer(a);
      expect(seen).toHaveBeenLastCalledWith(null);
    });

    it('does not announce a rewrite that leaves the timer as it was, or another key', () => {
      const doc = new Y.Doc();
      startTimer(doc, MIN, ADA, T0);
      const seen = vi.fn();
      observeTimer(doc, seen);

      doc.getMap(SESSION_MAP_KEY).set('other', 1);
      doc.getMap(SESSION_MAP_KEY).set(TIMER_KEY, readTimer(doc));

      expect(seen).not.toHaveBeenCalled();
    });

    it('says the state again on request, also when nothing changed, and stops when destroyed', () => {
      const doc = new Y.Doc();
      const seen = vi.fn();
      const sync = observeTimer(doc, seen);

      sync.emit();
      expect(seen).toHaveBeenCalledWith(null);

      sync.destroy();
      startTimer(doc, MIN, ADA, T0);
      expect(seen).toHaveBeenCalledTimes(1);
    });
  });
});
