import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import {
  HOVER_MARGIN,
  SNAP_RADIUS,
  connectableAt,
  connectionPoints,
  nearestPoint,
  nearestSide,
} from './connection-points';
import { sidePoint, type ScenePoint, type Side } from './connector';
import { STICKY_COLORS, type StickyColor } from './sticky-note';

/** A drag shorter than this (screen pixels) is a click on a circle and creates nothing. */
export const MIN_DRAG_DISTANCE = 8;

export function oppositeSide(side: Side): Side {
  return { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[side] as Side;
}

/**
 * The element a connector dragged to `pointer` would end on: the topmost connectable one under it or within reach of
 * its circles (they sit outside the border), never the source.
 */
export function dropTarget(
  elements: readonly ExcalidrawElement[],
  source: ExcalidrawElement,
  pointer: ScenePoint,
  zoom: number,
): ExcalidrawElement | undefined {
  return connectableAt(elements, pointer, zoom, HOVER_MARGIN, source.id);
}

/**
 * The side of `target` a connector from `dragSide` of `source` ends on: the circle the pointer is close to, otherwise
 * the side nearest to where the connector leaves the source (picking the circle nearest to a pointer that is over
 * the middle of the shape would send the connector across it).
 */
export function dropSide(
  source: ExcalidrawElement,
  dragSide: Side,
  target: ExcalidrawElement,
  pointer: ScenePoint,
  zoom: number,
): Side {
  const near = nearestPoint(connectionPoints(target, zoom), pointer, zoom);
  if (near && near.distance <= SNAP_RADIUS) return near.point.side;
  return nearestSide(target, sidePoint(source, dragSide));
}

/** The sticky color that matches an element's border (a note made by the toolbar), otherwise the first color. */
export function stickyColorOf(element: ExcalidrawElement): StickyColor {
  const stroke = element.strokeColor.toLowerCase();
  return STICKY_COLORS.find((color) => color.hex === stroke) ?? STICKY_COLORS[0];
}

/** The distance between two scene points in screen pixels. */
export function screenDistance(a: ScenePoint, b: ScenePoint, zoom: number): number {
  return Math.hypot(a.x - b.x, a.y - b.y) * zoom;
}
