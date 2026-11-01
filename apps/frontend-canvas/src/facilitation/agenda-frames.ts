import type { Viewport } from '../presence/viewport';
import type { AgendaFrame } from './AgendaPanel';

/** The part of an Excalidraw element the agenda looks at. */
export interface FrameCandidate {
  id: string;
  type: string;
  name?: string | null;
  isDeleted?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoardFrames {
  /** The frames of the board by id, with their names (`null` for an unnamed one). */
  frames: ReadonlyMap<string, string | null>;
  /** The one selected frame, or `null` when none or several are selected. */
  selected: AgendaFrame | null;
  /** The two above as a string: the panel is drawn again only when it changes. */
  key: string;
}

const isFrame = (element: FrameCandidate) =>
  !element.isDeleted && (element.type === 'frame' || element.type === 'magicframe');

/** The frames of the board and the selected one, for the agenda panel (#849). */
export function boardFrames(
  elements: readonly FrameCandidate[],
  selectedIds: Readonly<Record<string, boolean>>,
): BoardFrames {
  const frames = new Map<string, string | null>();
  const selected: AgendaFrame[] = [];
  for (const element of elements) {
    if (!isFrame(element)) continue;
    const name = element.name?.trim() || null;
    frames.set(element.id, name);
    if (selectedIds[element.id]) selected.push({ id: element.id, name });
  }
  const one = selected.length === 1 ? selected[0] : null;
  return {
    frames,
    selected: one,
    key: JSON.stringify([[...frames], one?.id ?? null]),
  };
}

/** The part of the board to bring everybody to for a frame: the frame and a margin of 5 % of its longer side. */
export function frameViewport(frame: FrameCandidate): Viewport | null {
  if (!(frame.width > 0 && frame.height > 0)) return null;
  const pad = Math.max(frame.width, frame.height) * 0.05;
  return {
    x: frame.x - pad,
    y: frame.y - pad,
    width: frame.width + 2 * pad,
    height: frame.height + 2 * pad,
  };
}
