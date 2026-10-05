import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { throttle } from './throttle';

describe('throttle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs the first call at once', () => {
    const run = vi.fn();
    throttle(run, 50)(1);

    expect(run).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('folds calls inside the interval into one with the latest value, run when it is over', () => {
    const run = vi.fn();
    const call = throttle(run, 50);

    call(1);
    call(2);
    call(3);
    expect(run.mock.calls).toEqual([[1]]);
    vi.advanceTimersByTime(49);
    expect(run.mock.calls).toEqual([[1]]);
    vi.advanceTimersByTime(1);

    expect(run.mock.calls).toEqual([[1], [3]]);
  });

  it('runs again at once after a quiet interval', () => {
    const run = vi.fn();
    const call = throttle(run, 50);
    call(1);

    vi.advanceTimersByTime(60);
    call(2);

    expect(run.mock.calls).toEqual([[1], [2]]);
  });

  it('never runs more often than once per interval under steady calls', () => {
    const run = vi.fn();
    const call = throttle(run, 50);

    for (let t = 0; t < 1000; t += 5) {
      call(t);
      vi.advanceTimersByTime(5);
    }
    vi.advanceTimersByTime(100);

    expect(run.mock.calls.length).toBeLessThanOrEqual(1000 / 50 + 2);
    expect(run.mock.calls.length).toBeGreaterThan(10);
    expect(run.mock.calls.at(-1)?.[0]).toBe(995); // the last value was not lost
  });

  it('cancel drops what is waiting', () => {
    const run = vi.fn();
    const call = throttle(run, 50);
    call(1);
    call(2);

    call.cancel();
    vi.advanceTimersByTime(200);

    expect(run.mock.calls).toEqual([[1]]);
  });
});
