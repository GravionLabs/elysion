/** The selected element ids in the order they were picked, and whether that order is known. */
export interface SelectionOrder {
  readonly ids: readonly string[];
  /** False when several elements joined the selection in one step (a rubber band, select all): no order then. */
  readonly known: boolean;
}

export const NO_SELECTION: SelectionOrder = { ids: [], known: true };

/**
 * The order after a change of the selection: elements that stay keep their place, an element that joined goes last.
 * If more than one joined at once, nobody can tell which came first.
 */
export function trackSelection(
  previous: SelectionOrder,
  selectedIds: Readonly<Record<string, boolean>>,
): SelectionOrder {
  const selected = Object.keys(selectedIds).filter((id) => selectedIds[id]);
  const kept = previous.ids.filter((id) => selectedIds[id]);
  const joined = selected.filter((id) => !kept.includes(id));
  if (joined.length === 0 && kept.length === previous.ids.length) return previous;
  const known = (kept.length === 0 ? true : previous.known) && joined.length <= 1;
  return { ids: [...kept, ...joined], known: joined.length > 1 ? false : known };
}
