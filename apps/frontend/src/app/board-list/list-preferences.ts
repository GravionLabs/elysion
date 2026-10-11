/** How the board overview is ordered (#730). */
export type BoardSort = 'newest' | 'name' | 'opened';

export const BOARD_SORTS: readonly BoardSort[] = ['newest', 'name', 'opened'];

const STORAGE_KEY = 'elysion.board-sort';

/** The remembered order, or `newest` when none was stored, it is not one of the choices, or the storage is not available. */
export function loadSort(): BoardSort {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return BOARD_SORTS.find((sort) => sort === stored) ?? 'newest';
  } catch {
    return 'newest';
  }
}

export function saveSort(sort: BoardSort): void {
  try {
    localStorage.setItem(STORAGE_KEY, sort);
  } catch {
    // Private mode or blocked storage: the order only lasts until the page is left.
  }
}
