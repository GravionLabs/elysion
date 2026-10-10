import { DEFAULT_STICKY_COLOR, STICKY_COLORS, type StickyColor } from './sticky-note';

/**
 * Settings of the canvas that a person keeps per browser (not per board): the color of the next sticky note. Stored in `localStorage`, which
 * can be missing or throw (a private window, blocked site data): every access is guarded and the defaults apply.
 */

/** What this browser remembered of the grid before it became a setting of the board (#754): removed when the canvas starts. */
export const LEGACY_GRID_KEYS = [
  'elysion.grid.show',
  'elysion.grid.snap',
  'elysion.grid.size',
] as const;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function forgetLegacyGridSettings(store: Storage | null = storage()): void {
  if (!store) return;
  try {
    for (const key of LEGACY_GRID_KEYS) store.removeItem(key);
  } catch {
    // a blocked storage has nothing to remove
  }
}

const STICKY_KEY = 'elysion.sticky.color';

/** The color the next sticky note gets: the one used last, yellow when none is stored or the value is not a color. */
export function readStickyColor(store: Storage | null = storage()): StickyColor {
  if (!store) return DEFAULT_STICKY_COLOR;
  try {
    const name = store.getItem(STICKY_KEY);
    return STICKY_COLORS.find((color) => color.name === name) ?? DEFAULT_STICKY_COLOR;
  } catch {
    return DEFAULT_STICKY_COLOR;
  }
}

export function writeStickyColor(color: StickyColor, store: Storage | null = storage()): void {
  if (!store) return;
  try {
    store.setItem(STICKY_KEY, color.name);
  } catch {
    // Not stored: the color lasts until the page is closed.
  }
}
