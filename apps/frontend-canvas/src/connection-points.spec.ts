import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { describe, expect, it } from 'vitest';
import {
  MAX_SHAPES_WITH_POINTS,
  POINT_OFFSET,
  connectableAt,
  connectionPoints,
  containsPoint,
  hoveredShape,
  nearestSide,
  shapesWithPoints,
  toScene,
  toScreen,
} from './connection-points';

const shape = (
  x: number,
  y: number,
  width = 100,
  height = 60,
  type = 'rectangle',
): ExcalidrawElement => convertToExcalidrawElements([{ type, x, y, width, height } as never])[0];

const rotated = (element: ExcalidrawElement, angle: number) =>
  ({ ...element, angle }) as ExcalidrawElement;

describe('connectionPoints', () => {
  it('are the middles of the four sides, POINT_OFFSET outside the border', () => {
    const points = connectionPoints(shape(10, 20, 100, 60));

    expect(points.map((p) => p.side)).toEqual(['top', 'right', 'bottom', 'left']);
    expect(points[0]).toMatchObject({ x: 60, y: 20 - POINT_OFFSET });
    expect(points[1]).toMatchObject({ x: 110 + POINT_OFFSET, y: 50 });
    expect(points[2]).toMatchObject({ x: 60, y: 80 + POINT_OFFSET });
    expect(points[3]).toMatchObject({ x: 10 - POINT_OFFSET, y: 50 });
  });

  it('keep their size on screen: the offset in scene units shrinks as the zoom grows', () => {
    const [top] = connectionPoints(shape(0, 0, 100, 60), 2);

    expect(top.y).toBeCloseTo(-POINT_OFFSET / 2, 5);
  });

  it('turn with a shape rotated by 90 degrees (its right side is where the bottom side was)', () => {
    const points = connectionPoints(rotated(shape(0, 0, 100, 60), Math.PI / 2));
    const right = points.find((p) => p.side === 'right')!;

    expect(right.x).toBeCloseTo(50, 5);
    expect(right.y).toBeCloseTo(30 + 50 + POINT_OFFSET, 5); // center y + half the width, then the offset
  });

  it('turn with a shape rotated by 45 degrees and stay outside the border', () => {
    const element = rotated(shape(0, 0, 100, 100), Math.PI / 4);
    const [top] = connectionPoints(element);
    const center = { x: 50, y: 50 };

    expect(Math.hypot(top.x - center.x, top.y - center.y)).toBeCloseTo(50 + POINT_OFFSET, 5);
    expect(top.x).toBeGreaterThan(center.x); // rotated clockwise, the top side points up and to the right
  });
});

describe('toScreen and toScene', () => {
  const view = (zoom: number) => ({ scrollX: 40, scrollY: -20, zoom });

  it.each([0.5, 1, 2])('map a scene point to the canvas and back at zoom %s', (zoom) => {
    const point = { x: 100, y: 50 };

    const onScreen = toScreen(point, view(zoom));

    expect(onScreen).toEqual({ x: (100 + 40) * zoom, y: (50 - 20) * zoom });
    expect(toScene(onScreen, view(zoom))).toEqual(point);
  });
});

describe('containsPoint', () => {
  it('uses the element box with an optional margin', () => {
    const a = shape(0, 0, 100, 60);

    expect(containsPoint(a, { x: 50, y: 30 })).toBe(true);
    expect(containsPoint(a, { x: 101, y: 30 })).toBe(false);
    expect(containsPoint(a, { x: 110, y: 30 }, 12)).toBe(true);
  });

  it('works in the frame of a rotated element', () => {
    const a = rotated(shape(0, 0, 100, 20), Math.PI / 2); // upright, it is 20 wide and 100 tall around (50, 10)

    expect(containsPoint(a, { x: 50, y: 55 })).toBe(true);
    expect(containsPoint(a, { x: 90, y: 10 })).toBe(false);
  });
});

describe('connectableAt and hoveredShape', () => {
  it('finds the topmost connectable element and skips the one asked to', () => {
    const below = shape(0, 0, 200, 200);
    const above = shape(50, 50, 50, 50);

    expect(connectableAt([below, above], { x: 70, y: 70 }, 1)).toBe(above);
    expect(connectableAt([below, above], { x: 70, y: 70 }, 1, 0, above.id)).toBe(below);
    expect(connectableAt([below, above], { x: 500, y: 500 }, 1)).toBeUndefined();
  });

  it('ignores arrows, deleted elements and text inside a shape', () => {
    const [arrow] = convertToExcalidrawElements([
      {
        type: 'arrow',
        x: 0,
        y: 0,
        points: [
          [0, 0],
          [100, 100],
        ],
      },
    ] as never);
    const deleted = { ...shape(0, 0, 100, 100), isDeleted: true } as ExcalidrawElement;

    expect(connectableAt([arrow, deleted], { x: 50, y: 50 }, 1)).toBeUndefined();
  });

  it('counts the room around a shape for its points as hovering it, whatever the zoom', () => {
    const a = shape(0, 0, 100, 60);

    expect(hoveredShape([a], { x: 100 + POINT_OFFSET, y: 30 }, 1)).toBe(a); // on the right circle
    expect(hoveredShape([a], { x: 100 + 40, y: 30 }, 1)).toBeUndefined();
    expect(hoveredShape([a], { x: 100 + 40, y: 30 }, 0.25)).toBe(a); // 40 scene units are 10 px at this zoom
  });
});

describe('nearestSide', () => {
  it('is the side whose middle is nearest to the point', () => {
    const a = shape(0, 0, 100, 60);

    expect(nearestSide(a, { x: 300, y: 30 })).toBe('right');
    expect(nearestSide(a, { x: -300, y: 30 })).toBe('left');
    expect(nearestSide(a, { x: 50, y: 300 })).toBe('bottom');
    expect(nearestSide(a, { x: 50, y: -300 })).toBe('top');
  });
});

describe('shapesWithPoints', () => {
  it('are the selected shapes and the hovered one, not arrows or text inside a shape', () => {
    const a = shape(0, 0);
    const b = shape(200, 0);
    const c = shape(400, 0);
    const [arrow] = convertToExcalidrawElements([
      {
        type: 'arrow',
        x: 0,
        y: 0,
        points: [
          [0, 0],
          [10, 10],
        ],
      },
    ] as never);

    const shown = shapesWithPoints([a, b, c, arrow], { [a.id]: true, [arrow.id]: true }, c.id);

    expect(shown).toEqual([a, c]);
  });

  it('shows none when nothing is selected or hovered', () => {
    expect(shapesWithPoints([shape(0, 0)], {}, null)).toEqual([]);
  });

  it('shows at most ten, and the hovered one is never the one left out', () => {
    const many = Array.from({ length: 14 }, (_, i) => shape(i * 150, 0));
    const selected = Object.fromEntries(many.slice(0, 13).map((e) => [e.id, true]));

    const shown = shapesWithPoints(many, selected, many[13].id);

    expect(shown).toHaveLength(MAX_SHAPES_WITH_POINTS);
    expect(shown).toContain(many[13]);
  });
});
