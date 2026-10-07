import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { describe, expect, it } from 'vitest';
import {
  MIN_DRAG_DISTANCE,
  dropSide,
  dropTarget,
  oppositeSide,
  screenDistance,
  stickyColorOf,
} from './connection-drop';
import { connectionPoints, nearestPoint, SNAP_RADIUS } from './connection-points';
import { STICKY_COLORS } from './sticky-note';

const shape = (
  x: number,
  y: number,
  width = 100,
  height = 60,
  strokeColor?: string,
): ExcalidrawElement =>
  convertToExcalidrawElements([
    { type: 'rectangle', x, y, width, height, strokeColor } as never,
  ])[0];

describe('nearestPoint', () => {
  it('is the nearest point with its distance on screen', () => {
    const points = connectionPoints(shape(0, 0, 100, 60));

    const near = nearestPoint(points, { x: 150, y: 30 }, 2);

    expect(near?.point.side).toBe('right');
    expect(near?.distance).toBeCloseTo(2 * (150 - 108), 5); // the right point is at x = 108, scaled by the zoom
    expect(nearestPoint([], { x: 0, y: 0 }, 1)).toBeUndefined();
  });
});

describe('oppositeSide', () => {
  it('turns a side around', () => {
    expect(oppositeSide('left')).toBe('right');
    expect(oppositeSide('right')).toBe('left');
    expect(oppositeSide('top')).toBe('bottom');
    expect(oppositeSide('bottom')).toBe('top');
  });
});

describe('dropTarget', () => {
  it('is the topmost connectable element under the pointer or within reach of its circles, never the source', () => {
    const source = shape(0, 0);
    const target = shape(300, 0);

    expect(dropTarget([source, target], source, { x: 350, y: 30 }, 1)).toBe(target);
    expect(dropTarget([source, target], source, { x: 285, y: 30 }, 1)).toBe(target); // on its left circle
    expect(dropTarget([source, target], source, { x: 200, y: 30 }, 1)).toBeUndefined();
    expect(dropTarget([source, target], source, { x: 50, y: 30 }, 1)).toBeUndefined(); // only the source is there
  });
});

describe('dropSide', () => {
  it('is the circle the pointer is close to', () => {
    const source = shape(0, 0);
    const target = shape(300, 0);

    expect(dropSide(source, 'right', target, { x: 350, y: 60 + 8 + 2 }, 1)).toBe('bottom');
    expect(dropSide(source, 'right', target, { x: 350, y: -8 - 2 }, 1)).toBe('top');
  });

  it('is the side nearest to where the connector leaves the source when the pointer is not near a circle', () => {
    const source = shape(0, 0);
    const target = shape(300, 0);
    const middle = { x: 350, y: 30 }; // over the middle of the target: 50 units from every circle

    expect(50).toBeGreaterThan(SNAP_RADIUS);
    expect(dropSide(source, 'right', target, middle, 1)).toBe('left');
    expect(dropSide(source, 'bottom', shape(0, 300), { x: 50, y: 330 }, 1)).toBe('top');
  });
});

describe('stickyColorOf', () => {
  it('matches the border of a note made by the toolbar, ignoring case', () => {
    const teal = STICKY_COLORS[1];

    expect(stickyColorOf(shape(0, 0, 100, 60, teal.hex.toUpperCase()))).toBe(teal);
  });

  it('is the first color for anything else', () => {
    expect(stickyColorOf(shape(0, 0))).toBe(STICKY_COLORS[0]);
  });
});

describe('screenDistance', () => {
  it('is the distance in pixels at the zoom, and a drag is a drag from MIN_DRAG_DISTANCE on', () => {
    expect(screenDistance({ x: 0, y: 0 }, { x: 3, y: 4 }, 2)).toBe(10);
    expect(MIN_DRAG_DISTANCE).toBe(8);
  });
});
