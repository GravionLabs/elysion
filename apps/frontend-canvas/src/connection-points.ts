import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { isConnectable, sideDirection, sidePoint, type ScenePoint, type Side } from './connector';

export { isConnectable };

export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/** Connection points sit this far outside the shape's border, and are this big, both in screen pixels. */
export const POINT_OFFSET = 8;
export const POINT_DIAMETER = 10;

/** At most this many shapes show their points at once (the selected ones, and the hovered one). */
export const MAX_SHAPES_WITH_POINTS = 10;

/** How far from a shape's border the pointer may be and still count as on it, in screen pixels: room for the points. */
export const HOVER_MARGIN = POINT_OFFSET + POINT_DIAMETER + 4;

export interface ConnectionPoint extends ScenePoint {
  readonly side: Side;
}

/** The view of the canvas, as Excalidraw's app state has it. */
export interface View {
  readonly scrollX: number;
  readonly scrollY: number;
  readonly zoom: number;
}

/**
 * The four points of a shape, at the middle of its sides and in scene coordinates, rotated with the shape. The
 * points are `POINT_OFFSET` screen pixels outside the border, which depends on the zoom, hence the argument.
 */
export function connectionPoints(element: ExcalidrawElement, zoom = 1): ConnectionPoint[] {
  return SIDES.map((side) => {
    const on = sidePoint(element, side);
    const out = sideDirection(element, side);
    const distance = POINT_OFFSET / zoom;
    return { side, x: on.x + out.x * distance, y: on.y + out.y * distance };
  });
}

/** A scene point as a position inside the canvas, in screen pixels. */
export function toScreen(point: ScenePoint, view: View): ScenePoint {
  return { x: (point.x + view.scrollX) * view.zoom, y: (point.y + view.scrollY) * view.zoom };
}

/** A position inside the canvas, in screen pixels, as a scene point. */
export function toScene(point: ScenePoint, view: View): ScenePoint {
  return { x: point.x / view.zoom - view.scrollX, y: point.y / view.zoom - view.scrollY };
}

/** Whether a scene point is on an element's box (in the element's own, rotated frame), `margin` scene units around it. */
export function containsPoint(element: ExcalidrawElement, point: ScenePoint, margin = 0): boolean {
  const dx = point.x - (element.x + element.width / 2);
  const dy = point.y - (element.y + element.height / 2);
  const cos = Math.cos(-element.angle);
  const sin = Math.sin(-element.angle);
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  return (
    Math.abs(localX) <= element.width / 2 + margin &&
    Math.abs(localY) <= element.height / 2 + margin
  );
}

/** The topmost connectable element at a scene point (`margin` is in screen pixels), without `exceptId`. */
export function connectableAt(
  elements: readonly ExcalidrawElement[],
  point: ScenePoint,
  zoom: number,
  margin = 0,
  exceptId?: string,
): ExcalidrawElement | undefined {
  for (let i = elements.length - 1; i >= 0; i--) {
    const element = elements[i];
    if (
      element.id !== exceptId &&
      isConnectable(element) &&
      containsPoint(element, point, margin / zoom)
    ) {
      return element;
    }
  }
  return undefined;
}

/** The topmost connectable element under the pointer, with room around it for its points (the hover rule). */
export function hoveredShape(
  elements: readonly ExcalidrawElement[],
  point: ScenePoint,
  zoom: number,
): ExcalidrawElement | undefined {
  return connectableAt(elements, point, zoom, HOVER_MARGIN);
}

/** A pointer this close (screen pixels) to a circle of the target snaps to that circle. */
export const SNAP_RADIUS = 16;

/** The connection point nearest to a scene point, with its distance on screen (in pixels), or `undefined` for none. */
export function nearestPoint(
  points: readonly ConnectionPoint[],
  pointer: ScenePoint,
  zoom: number,
): { point: ConnectionPoint; distance: number } | undefined {
  let best: { point: ConnectionPoint; distance: number } | undefined;
  for (const point of points) {
    const distance = Math.hypot(point.x - pointer.x, point.y - pointer.y) * zoom;
    if (!best || distance < best.distance) best = { point, distance };
  }
  return best;
}

/** The side of an element whose middle is nearest to a scene point. */
export function nearestSide(element: ExcalidrawElement, point: ScenePoint): Side {
  let best: Side = 'top';
  let bestDistance = Infinity;
  for (const side of SIDES) {
    const on = sidePoint(element, side);
    const distance = Math.hypot(on.x - point.x, on.y - point.y);
    if (distance < bestDistance) {
      best = side;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The shapes that show their points: the hovered one and the selected ones, at most ten (the hovered one is never
 * the one left out), in scene order.
 */
export function shapesWithPoints(
  elements: readonly ExcalidrawElement[],
  selectedIds: Readonly<Record<string, boolean>>,
  hoveredId: string | null,
): ExcalidrawElement[] {
  const wanted = elements.filter(
    (element) => isConnectable(element) && (selectedIds[element.id] || element.id === hoveredId),
  );
  const hovered = wanted.find((element) => element.id === hoveredId);
  const rest = wanted
    .filter((element) => element !== hovered)
    .slice(0, MAX_SHAPES_WITH_POINTS - (hovered ? 1 : 0));
  const keep = new Set<ExcalidrawElement>([...(hovered ? [hovered] : []), ...rest]);
  return wanted.filter((element) => keep.has(element));
}
