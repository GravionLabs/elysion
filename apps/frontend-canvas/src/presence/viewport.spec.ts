import { describe, expect, it } from 'vitest';
import {
  fitViewport,
  MAX_ZOOM,
  MIN_ZOOM,
  parseViewport,
  sameView,
  sameViewport,
  viewportOf,
} from './viewport';

describe('viewportOf', () => {
  it('gives the scene rectangle a window shows', () => {
    expect(
      viewportOf({ scrollX: -100, scrollY: 50, zoom: 2 }, { width: 800, height: 600 }),
    ).toEqual({ x: 100, y: -50, width: 400, height: 300 });
  });
});

describe('fitViewport', () => {
  it('shows a target of the same shape exactly', () => {
    const view = fitViewport(
      { x: 100, y: 200, width: 400, height: 300 },
      { width: 800, height: 600 },
    );
    expect(view).toEqual({ zoom: 2, scrollX: -100, scrollY: -200 });
  });

  it('keeps the follower aspect ratio: a wider window shows more at the sides, never less', () => {
    const view = fitViewport({ x: 0, y: 0, width: 400, height: 300 }, { width: 1600, height: 600 });
    expect(view.zoom).toBe(2); // the height limits
    expect(viewportOf(view, { width: 1600, height: 600 })).toEqual({
      x: -200,
      y: 0,
      width: 800,
      height: 300,
    });
  });

  it('shows more above and below for a taller window', () => {
    const view = fitViewport({ x: 0, y: 0, width: 400, height: 300 }, { width: 800, height: 1200 });
    expect(view.zoom).toBe(2);
    expect(viewportOf(view, { width: 800, height: 1200 })).toEqual({
      x: 0,
      y: -150,
      width: 400,
      height: 600,
    });
  });

  it('stays inside the zoom limits of Excalidraw', () => {
    expect(fitViewport({ x: 0, y: 0, width: 1, height: 1 }, { width: 800, height: 600 }).zoom).toBe(
      MAX_ZOOM,
    );
    expect(
      fitViewport({ x: 0, y: 0, width: 1e6, height: 1e6 }, { width: 800, height: 600 }).zoom,
    ).toBe(MIN_ZOOM);
  });
});

describe('parseViewport', () => {
  it('accepts a rectangle with area', () => {
    expect(parseViewport({ x: 1, y: -2, width: 3, height: 4, extra: true })).toEqual({
      x: 1,
      y: -2,
      width: 3,
      height: 4,
    });
  });

  it.each([
    null,
    undefined,
    'x',
    {},
    { x: 0, y: 0, width: 0, height: 5 },
    { x: 0, y: 0, width: 5, height: -1 },
    { x: NaN, y: 0, width: 5, height: 5 },
    { x: '0', y: 0, width: 5, height: 5 },
    { x: 0, y: 0, width: Infinity, height: 5 },
  ])('refuses %j', (value) => {
    expect(parseViewport(value)).toBeNull();
  });
});

describe('sameView and sameViewport', () => {
  it('ignores float noise but not a real change', () => {
    const view = { scrollX: 10, scrollY: 20, zoom: 1.5 };
    expect(sameView(view, { ...view, scrollX: 10 + 1e-9 })).toBe(true);
    expect(sameView(view, { ...view, scrollY: 21 })).toBe(false);
    expect(sameView(view, { ...view, zoom: 1.6 })).toBe(false);
  });

  it('compares viewports field by field', () => {
    const a = { x: 1, y: 2, width: 3, height: 4 };
    expect(sameViewport(a, { ...a })).toBe(true);
    expect(sameViewport(a, { ...a, width: 5 })).toBe(false);
    expect(sameViewport(a, undefined)).toBe(false);
    expect(sameViewport(undefined, undefined)).toBe(true);
  });
});
