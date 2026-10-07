import type * as Y from 'yjs';
import { SESSION_MAP_KEY, type TimerState, readTimer } from './timer';

export interface TimerSync {
  /** Tells the callback the current state again (also when it did not change): what a client gets after it connected. */
  emit(): void;
  destroy(): void;
}

/**
 * Watches the shared timer of a document and calls `onChange` with the state (or `null`) whenever it changes, on this
 * client or on any other. A change of the map that leaves the timer as it was (another key, a rewrite with the same
 * values) is not announced.
 */
export function observeTimer(doc: Y.Doc, onChange: (state: TimerState | null) => void): TimerSync {
  const map = doc.getMap<unknown>(SESSION_MAP_KEY);
  let last = JSON.stringify(readTimer(doc));
  const observer = () => {
    const state = readTimer(doc);
    const json = JSON.stringify(state);
    if (json === last) return;
    last = json;
    onChange(state);
  };
  map.observe(observer);
  return {
    emit: () => onChange(readTimer(doc)),
    destroy: () => map.unobserve(observer),
  };
}
