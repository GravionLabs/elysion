import type * as Y from 'yjs';

/**
 * Settings that belong to the board, not to a person: the grid (#754). They live in the document's map `meta`, next to
 * `elements`, `session` and `files`, so everybody on the board sees the same grid, they persist with the document and a copy of
 * the board keeps them. They are outside the Excalidraw binding: Ctrl+Z never touches them and no export contains them.
 *
 * A board without the key (every new board, and every board from before this) has the defaults: the grid shown and snapped to.
 */
export const META_MAP_KEY = 'meta';
export const GRID_KEY = 'grid';

export const GRID_SIZES = [10, 20, 40] as const;
export type GridSize = (typeof GRID_SIZES)[number];

export interface GridSettings {
  /** Draw the grid as dots in the background (grid-dots.ts). Independent of snapping. */
  show: boolean;
  /** Snap to the grid while dragging, whether it is shown or not. */
  snap: boolean;
  size: GridSize;
  /** Snap to the edges and centers of other elements, with guide lines while dragging (Excalidraw's object snapping, #755). */
  guides: boolean;
}

export const DEFAULT_GRID: GridSettings = { show: true, snap: true, size: 20, guides: true };

/** A stored value as grid settings: what is valid is taken, the rest is the default (another client may have written anything). */
export function parseGrid(value: unknown): GridSettings {
  if (typeof value !== 'object' || value === null) return DEFAULT_GRID;
  const v = value as { show?: unknown; snap?: unknown; size?: unknown; guides?: unknown };
  return {
    show: typeof v.show === 'boolean' ? v.show : DEFAULT_GRID.show,
    snap: typeof v.snap === 'boolean' ? v.snap : DEFAULT_GRID.snap,
    size: (GRID_SIZES as readonly unknown[]).includes(v.size)
      ? (v.size as GridSize)
      : DEFAULT_GRID.size,
    guides: typeof v.guides === 'boolean' ? v.guides : DEFAULT_GRID.guides,
  };
}

export function readGrid(doc: Y.Doc): GridSettings {
  return parseGrid(doc.getMap<unknown>(META_MAP_KEY).get(GRID_KEY));
}

/**
 * Changes some of the grid settings: written once, as a whole object, and only when something differs, so a click that
 * changes nothing sends nothing. The whole object (not one key each) because a plain value in a Yjs map is replaced as one.
 */
export function writeGrid(doc: Y.Doc, change: Partial<GridSettings>): void {
  const current = readGrid(doc);
  const next = { ...current, ...change };
  const same =
    next.show === current.show &&
    next.snap === current.snap &&
    next.size === current.size &&
    next.guides === current.guides;
  if (same) return;
  doc.getMap<unknown>(META_MAP_KEY).set(GRID_KEY, next);
}

/** Calls `onChange` with the settings whenever they change, on this client or any other (not for another key of the map). */
export function observeGrid(doc: Y.Doc, onChange: (grid: GridSettings) => void): () => void {
  const map = doc.getMap<unknown>(META_MAP_KEY);
  let last = JSON.stringify(readGrid(doc));
  const observer = () => {
    const grid = readGrid(doc);
    const json = JSON.stringify(grid);
    if (json === last) return;
    last = json;
    onChange(grid);
  };
  map.observe(observer);
  return () => map.unobserve(observer);
}
