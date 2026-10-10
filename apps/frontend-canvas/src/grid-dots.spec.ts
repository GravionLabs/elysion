import { describe, expect, it } from 'vitest';
import { MIN_DOT_SPACING, applyGridDots, gridDots } from './grid-dots';

describe('gridDots', () => {
  it('puts a dot on every grid point: the tile starts half a spacing before it', () => {
    // Grid point 0 is at screen x = scrollX * zoom = 30; the tile (spacing 20) has its dot in the middle.
    const dots = gridDots({ zoom: 1, scrollX: 30, scrollY: 0, size: 20 });

    expect(dots.spacing).toBe(20);
    expect(dots.offsetX).toBe(0); // (30 - 10) mod 20
    expect(dots.offsetY).toBe(10); // (0 - 10) mod 20, kept positive
  });

  it('scales the spacing and the offset with the zoom', () => {
    const half = gridDots({ zoom: 0.5, scrollX: 100, scrollY: 100, size: 40 });
    const twice = gridDots({ zoom: 2, scrollX: 100, scrollY: 100, size: 20 });

    expect(half.spacing).toBe(20);
    expect(half.offsetX).toBe(0); // (50 - 10) mod 20
    expect(twice.spacing).toBe(40);
    expect(twice.offsetX).toBe(20); // (200 - 20) mod 40
  });

  it('is always an offset within one tile, also for a negative scroll', () => {
    for (const scroll of [-1234.5, -20, -1, 0, 7, 999.25]) {
      const { offsetX, spacing } = gridDots({ zoom: 1.25, scrollX: scroll, scrollY: 0, size: 20 });
      expect(offsetX).toBeGreaterThanOrEqual(0);
      expect(offsetX).toBeLessThan(spacing);
    }
  });

  it('fades out below the minimum spacing', () => {
    expect(gridDots({ zoom: 0.4, scrollX: 0, scrollY: 0, size: 20 }).visible).toBe(true); // 8 px
    expect(gridDots({ zoom: 0.3, scrollX: 0, scrollY: 0, size: 20 }).visible).toBe(false); // 6 px
    expect(MIN_DOT_SPACING).toBe(8);
  });
});

describe('applyGridDots', () => {
  it('writes the three custom properties and the faded flag', () => {
    const element = document.createElement('div');

    applyGridDots(element, { zoom: 1, scrollX: 30, scrollY: 0, size: 20 });
    expect(element.style.getPropertyValue('--grid-spacing')).toBe('20px');
    expect(element.style.getPropertyValue('--grid-offset-x')).toBe('0px');
    expect(element.hasAttribute('data-grid-faded')).toBe(false);

    applyGridDots(element, { zoom: 0.1, scrollX: 0, scrollY: 0, size: 20 });
    expect(element.hasAttribute('data-grid-faded')).toBe(true);
  });
});
