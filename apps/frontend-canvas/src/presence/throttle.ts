/**
 * Calls `run` at most once per `intervalMs`: the first call goes through at once, calls inside the
 * interval are folded into one that runs when the interval is over with the latest value, so the last
 * position of a pointer is never lost.
 */
export function throttle<T>(run: (value: T) => void, intervalMs: number) {
  let lastRun = -Infinity;
  let pending: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    if (pending) {
      const { value } = pending;
      pending = null;
      lastRun = Date.now();
      run(value);
    }
  };

  const call = (value: T) => {
    const wait = lastRun + intervalMs - Date.now();
    if (wait <= 0 && timer === null) {
      lastRun = Date.now();
      run(value);
      return;
    }
    pending = { value };
    timer ??= setTimeout(flush, Math.max(0, wait));
  };

  call.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  return call;
}
