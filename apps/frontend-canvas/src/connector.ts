import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';

/**
 * Connectors: ordinary Excalidraw arrows that are right-angled (`elbowed`) and bound to two shapes at both ends, so
 * they follow the shapes and sync, export and undo like any element (docs/specs/frontend.md, "Connectors").
 */

export type Side = 'top' | 'right' | 'bottom' | 'left';

export interface ScenePoint {
  readonly x: number;
  readonly y: number;
}

/** The element types a connector can be attached to. Bound text inside a shape is not one: it belongs to its shape. */
const CONNECTABLE_TYPES: ReadonlySet<string> = new Set([
  'rectangle',
  'diamond',
  'ellipse',
  'image',
  'frame',
  'text',
]);

export function isConnectable(element: ExcalidrawElement): boolean {
  if (element.isDeleted || !CONNECTABLE_TYPES.has(element.type)) return false;
  return !(element.type === 'text' && (element as { containerId?: string | null }).containerId);
}

/** How a connector looks, the same whichever way it was made. Matches the new-arrow defaults in `element-style.ts`. */
export const CONNECTOR_STYLE = {
  elbowed: true,
  roughness: 0,
  strokeWidth: 1,
  strokeColor: '#1a1c23',
  startArrowhead: null,
  endArrowhead: 'arrow',
} as const;

/** How far a connector runs straight out of a shape before it may turn, in scene units. */
const EXIT_LENGTH = 24;

const OUTWARD: Record<Side, ScenePoint> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

/** The middle of one side of an element, in scene coordinates, taking the element's rotation into account. */
export function sidePoint(element: ExcalidrawElement, side: Side): ScenePoint {
  const out = OUTWARD[side];
  const localX = (out.x * element.width) / 2;
  const localY = (out.y * element.height) / 2;
  const cos = Math.cos(element.angle);
  const sin = Math.sin(element.angle);
  return {
    x: element.x + element.width / 2 + localX * cos - localY * sin,
    y: element.y + element.height / 2 + localX * sin + localY * cos,
  };
}

/** The direction a side faces once the element's rotation is applied (the unit vector pointing out of it). */
export function sideDirection(element: ExcalidrawElement, side: Side): ScenePoint {
  const out = OUTWARD[side];
  const cos = Math.cos(element.angle);
  const sin = Math.sin(element.angle);
  return { x: out.x * cos - out.y * sin, y: out.x * sin + out.y * cos };
}

/** The axis a connector leaves a side along: a rotated shape's side points diagonally, the nearer axis is used. */
function outwardOf(element: ExcalidrawElement, side: Side): ScenePoint {
  const { x, y } = sideDirection(element, side);
  return Math.abs(x) >= Math.abs(y) ? { x: Math.sign(x), y: 0 } : { x: 0, y: Math.sign(y) };
}

/**
 * The sides that face each other: the larger of the distances between the centers decides between left/right and
 * top/bottom. (Used when the user did not pick the sides; picking "the nearest side to the pointer" would let a
 * connector cross the shape when the pointer is over its middle.)
 */
export function facingSides(
  source: ExcalidrawElement,
  target: ExcalidrawElement,
): { sourceSide: Side; targetSide: Side } {
  const dx = target.x + target.width / 2 - (source.x + source.width / 2);
  const dy = target.y + target.height / 2 - (source.y + source.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { sourceSide: 'right', targetSide: 'left' }
      : { sourceSide: 'left', targetSide: 'right' };
  }
  return dy >= 0
    ? { sourceSide: 'bottom', targetSide: 'top' }
    : { sourceSide: 'top', targetSide: 'bottom' };
}

const same = (a: ScenePoint, b: ScenePoint) => a.x === b.x && a.y === b.y;

/** Drops repeated points and points in the middle of a straight run. */
function simplify(points: ScenePoint[]): ScenePoint[] {
  const distinct = points.filter((point, i) => i === 0 || !same(point, points[i - 1]));
  return distinct.filter((point, i) => {
    if (i === 0 || i === distinct.length - 1) return true;
    const before = distinct[i - 1];
    const after = distinct[i + 1];
    const straightX = before.x === point.x && point.x === after.x;
    const straightY = before.y === point.y && point.y === after.y;
    return !(straightX || straightY);
  });
}

/**
 * A right-angled route from `from` (leaving in the direction `exit`) to `to` (which it enters against `entry`, the
 * direction its side faces). Excalidraw does not route a new elbow arrow itself, but it re-routes a bound one when a
 * shape moves, so this only has to be a clean first route: an L or a Z when the sides face each other, otherwise a
 * detour that leaves and enters straight (it may run along a shape; the next move of a shape tidies it).
 */
export function elbowRoute(
  from: ScenePoint,
  exit: ScenePoint,
  to: ScenePoint,
  entry: ScenePoint,
): ScenePoint[] {
  const exitHorizontal = exit.x !== 0;
  const entryHorizontal = entry.x !== 0;
  const movesTowards = (axis: 'x' | 'y', direction: number) =>
    Math.sign(to[axis] - from[axis]) === direction;

  if (exitHorizontal !== entryHorizontal) {
    // An L: out along the exit axis to the target's line, then along the other axis into the target.
    const corner = exitHorizontal ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
    const outOk = exitHorizontal ? movesTowards('x', exit.x) : movesTowards('y', exit.y);
    const inOk = exitHorizontal
      ? Math.sign(to.y - from.y) === -entry.y
      : Math.sign(to.x - from.x) === -entry.x;
    if (outOk && inOk) return simplify([from, corner, to]);
  } else if (exit.x === -entry.x && exit.y === -entry.y) {
    // Facing sides (right to left, bottom to top): a Z through the middle, when the target lies ahead.
    const ahead = exitHorizontal ? movesTowards('x', exit.x) : movesTowards('y', exit.y);
    if (ahead) {
      return simplify(
        exitHorizontal
          ? [from, { x: (from.x + to.x) / 2, y: from.y }, { x: (from.x + to.x) / 2, y: to.y }, to]
          : [from, { x: from.x, y: (from.y + to.y) / 2 }, { x: to.x, y: (from.y + to.y) / 2 }, to],
      );
    }
  }

  // The detour: straight out of the source, straight into the target, joined by right angles in between.
  const out = { x: from.x + exit.x * EXIT_LENGTH, y: from.y + exit.y * EXIT_LENGTH };
  const into = { x: to.x + entry.x * EXIT_LENGTH, y: to.y + entry.y * EXIT_LENGTH };
  if (exitHorizontal !== entryHorizontal) {
    const bend = exitHorizontal ? { x: out.x, y: into.y } : { x: into.x, y: out.y };
    return simplify([from, out, bend, into, to]);
  }
  if (exitHorizontal) {
    const middle = from.y === to.y ? from.y + EXIT_LENGTH * 3 : (from.y + to.y) / 2;
    return simplify([from, out, { x: out.x, y: middle }, { x: into.x, y: middle }, into, to]);
  }
  const middle = from.x === to.x ? from.x + EXIT_LENGTH * 3 : (from.x + to.x) / 2;
  return simplify([from, out, { x: middle, y: out.y }, { x: middle, y: into.y }, into, to]);
}

export interface ConnectorResult {
  /** The new connector. */
  arrow: ExcalidrawElement;
  /** The two shapes as they are now (they list the connector in `boundElements`): write these back with the arrow. */
  updated: [ExcalidrawElement, ExcalidrawElement];
}

/**
 * A connector from one element to another, as the elements to write back into the scene. Bound at both ends with the
 * sides given, or the sides that face each other. Excalidraw takes the attached side from where the arrow starts and
 * ends, so the first and last point of the route lie on the middle of the chosen sides.
 */
export function createConnector(
  elements: readonly ExcalidrawElement[],
  sourceId: string,
  targetId: string,
  sides?: { sourceSide: Side; targetSide: Side },
): ConnectorResult {
  if (sourceId === targetId) {
    throw new Error('A connector needs two different elements.');
  }
  const source = elements.find((element) => element.id === sourceId);
  const target = elements.find((element) => element.id === targetId);
  if (!source || !target) {
    throw new Error('Both elements of a connector have to be on the board.');
  }
  if (!isConnectable(source) || !isConnectable(target)) {
    throw new Error('A connector can only join shapes, images, frames and text.');
  }

  const { sourceSide, targetSide } = sides ?? facingSides(source, target);
  const from = sidePoint(source, sourceSide);
  const to = sidePoint(target, targetSide);
  const route = elbowRoute(from, outwardOf(source, sourceSide), to, outwardOf(target, targetSide));
  const xs = route.map((point) => point.x);
  const ys = route.map((point) => point.y);

  const converted = convertToExcalidrawElements(
    [
      source,
      target,
      {
        type: 'arrow',
        ...CONNECTOR_STYLE,
        x: from.x,
        y: from.y,
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
        points: route.map((point) => [point.x - from.x, point.y - from.y]),
        start: { id: source.id },
        end: { id: target.id },
      },
    ] as never,
    { regenerateIds: false },
  );
  // The shapes now list the connector: a newer version, so that the change is synced like any edit.
  const bumped = (original: ExcalidrawElement, current: ExcalidrawElement): ExcalidrawElement => ({
    ...current,
    version: original.version + 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    updated: Date.now(),
  });
  return {
    arrow: converted[2],
    updated: [bumped(source, converted[0]), bumped(target, converted[1])],
  };
}
