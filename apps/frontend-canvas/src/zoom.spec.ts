import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM, clampZoom, zoomAbout, type View } from './zoom';

const view: View = { scrollX: 100, scrollY: -50, zoom: 1, width: 800, height: 600 };

/** The scene point in the middle of the canvas. */
const centerOf = (v: Pick<View, 'scrollX' | 'scrollY' | 'zoom' | 'width' | 'height'>) => ({
  x: v.width / 2 / v.zoom - v.scrollX,
  y: v.height / 2 / v.zoom - v.scrollY,
});

describe('clampZoom', () => {
  it('rounds to two decimals, like Excalidraw', () => {
    expect(clampZoom(1.2345)).toBe(1.23);
    expect(clampZoom(0.1 + 0.2)).toBe(0.3);
  });

  it('keeps the zoom between 10% and 3000%', () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(500)).toBe(MAX_ZOOM);
  });
});

describe('zoomAbout', () => {
  it('keeps the scene point in the middle of the canvas where it is', () => {
    for (const next of [0.5, 1.1, 2, 7.5]) {
      const result = zoomAbout(view, next);

      const before = centerOf(view);
      const after = centerOf({ ...view, ...result });
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
    }
  });

  it('returns the clamped zoom it scrolled for', () => {
    const result = zoomAbout(view, 99);

    expect(result.zoom).toBe(MAX_ZOOM);
    const after = centerOf({ ...view, ...result });
    expect(after.x).toBeCloseTo(centerOf(view).x, 6);
  });

  it('does not scroll when the zoom does not change', () => {
    expect(zoomAbout(view, 1)).toEqual({ zoom: 1, scrollX: 100, scrollY: -50 });
  });
});
