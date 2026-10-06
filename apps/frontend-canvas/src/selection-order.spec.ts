import { describe, expect, it } from 'vitest';
import { NO_SELECTION, trackSelection } from './selection-order';

const sel = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, true]));

describe('trackSelection', () => {
  it('remembers the order in which elements were picked one by one', () => {
    const first = trackSelection(NO_SELECTION, sel('a'));
    const second = trackSelection(first, sel('a', 'b'));

    expect(second).toEqual({ ids: ['a', 'b'], known: true });
  });

  it('puts an element that joins last, and lets one that leaves go', () => {
    const state = trackSelection(trackSelection(NO_SELECTION, sel('a')), sel('a', 'b'));

    expect(trackSelection(state, sel('b'))).toEqual({ ids: ['b'], known: true });
    expect(trackSelection(state, sel('b', 'c'))).toEqual({ ids: ['b', 'c'], known: true });
  });

  it('does not know the order when several elements join at once (a rubber band, select all)', () => {
    const state = trackSelection(NO_SELECTION, sel('a', 'b'));

    expect(state.known).toBe(false);
    expect(state.ids).toEqual(['a', 'b']);
  });

  it('knows the order again after the selection was cleared', () => {
    const unknown = trackSelection(NO_SELECTION, sel('a', 'b'));

    const cleared = trackSelection(unknown, {});
    expect(trackSelection(cleared, sel('c'))).toEqual({ ids: ['c'], known: true });
  });

  it('returns the same state when nothing changed', () => {
    const state = trackSelection(NO_SELECTION, sel('a'));

    expect(trackSelection(state, sel('a'))).toBe(state);
  });
});
