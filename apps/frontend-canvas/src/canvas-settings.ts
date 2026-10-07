import { DEFAULT_STICKY_COLOR, STICKY_COLORS, type StickyColor } from './sticky-note';

/**
 * Settings of the canvas that a person keeps per browser (not per board): the grid and the color of the next sticky note. Stored in `localStorage`, which
 * can be missing or throw (a private window, blocked site data): every access is guarded and the defaults apply.
 */

export const GRID_SIZES = [10, 20, 40] as const;
export type GridSize = (typeof GRID_SIZES)[number];

export interface GridSettings {
  /** Draw the grid. In Excalidraw a shown grid is also snapped to. */
  show: boolean;
  /** Snap to the grid while dragging, also when it is not shown. */
  snap: boolean;
  size: GridSize;
}

export const DEFAULT_GRID: GridSettings = { show: false, snap: false, size: 20 };

export const GRID_KEYS = {
  show: 'elysion.grid.show',
  snap: 'elysion.grid.snap',
  size: 'elysion.grid.size',
} as const;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readGridSettings(store: Storage | null = storage()): GridSettings {
  if (!store) return DEFAULT_GRID;
  try {
    const size = Number(store.getItem(GRID_KEYS.size));
    return {
      show: store.getItem(GRID_KEYS.show) === 'true',
      snap: store.getItem(GRID_KEYS.snap) === 'true',
      size: (GRID_SIZES as readonly number[]).includes(size)
        ? (size as GridSize)
        : DEFAULT_GRID.size,
    };
  } catch {
    return DEFAULT_GRID;
  }
}

export function writeGridSettings(settings: GridSettings, store: Storage | null = storage()): void {
  if (!store) return;
  try {
    store.setItem(GRID_KEYS.show, String(settings.show));
    store.setItem(GRID_KEYS.snap, String(settings.snap));
    store.setItem(GRID_KEYS.size, String(settings.size));
  } catch {
    // Not stored: the settings last until the page is closed.
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
