import { describe, expect, it } from 'vitest';
import {
  MAX_IMAGE_BYTES,
  ROW_GAP,
  fileIdOf,
  fit,
  isImageFile,
  layoutRow,
  sortFiles,
} from './image-insert';

const file = (type: string, size = 100, name = 'x') =>
  new File([new Uint8Array(size)], name, { type });
const view = { viewWidth: 1000, viewHeight: 800, zoom: 1 };

describe('sortFiles', () => {
  it('accepts the raster types and SVG, and ignores what is no image', () => {
    const { accepted, refused } = sortFiles([
      file('image/png'),
      file('image/jpeg'),
      file('image/gif'),
      file('image/webp'),
      file('image/svg+xml'),
      file('text/plain'),
      file('application/pdf'),
    ]);

    expect(accepted.map((f) => f.type)).toEqual([
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'image/svg+xml',
    ]);
    expect(refused).toEqual([]);
  });

  it('refuses an image type the board cannot keep, and one that is too large, saying why', () => {
    const { accepted, refused } = sortFiles([
      file('image/bmp'),
      file('image/png', MAX_IMAGE_BYTES + 1),
      file('image/png', MAX_IMAGE_BYTES),
    ]);

    expect(accepted).toHaveLength(1);
    expect(refused.map((r) => r.problem)).toEqual(['type', 'size']);
  });

  it('knows an image file by its type', () => {
    expect(isImageFile(file('image/png'))).toBe(true);
    expect(isImageFile(file('text/plain'))).toBe(false);
  });
});

describe('fit', () => {
  it('keeps a small image as it is', () => {
    expect(fit({ width: 100, height: 50 }, view)).toEqual({ width: 100, height: 50 });
  });

  it('limits a tall image to half the view height and keeps its ratio', () => {
    const size = fit({ width: 500, height: 2000 }, view);

    expect(size.height).toBe(400);
    expect(size.width).toBe(100);
  });

  it('limits a wide image to half the view width', () => {
    const size = fit({ width: 4000, height: 1000 }, view);

    expect(size.width).toBe(500);
    expect(size.height).toBe(125);
  });

  it('gives a zoomed-out view a larger image in scene units (and a zoomed-in one a smaller)', () => {
    expect(fit({ width: 5000, height: 5000 }, { ...view, zoom: 0.5 }).height).toBe(800);
    expect(fit({ width: 5000, height: 5000 }, { ...view, zoom: 2 }).height).toBe(200);
  });
});

describe('layoutRow', () => {
  it('puts one image on the point, its middle there', () => {
    const [only] = layoutRow([{ width: 100, height: 60 }], { x: 500, y: 300 }, view);

    expect(only).toEqual({ x: 450, y: 270, width: 100, height: 60 });
  });

  it('puts several side by side with a gap, centered on the point, middles on one line', () => {
    const row = layoutRow(
      [
        { width: 100, height: 100 },
        { width: 200, height: 50 },
      ],
      { x: 0, y: 0 },
      view,
    );

    const total = 100 + ROW_GAP + 200;
    expect(row[0]!.x).toBe(-total / 2);
    expect(row[1]!.x).toBe(-total / 2 + 100 + ROW_GAP);
    expect(row.map((r) => r.y + r.height / 2)).toEqual([0, 0]);
  });

  it('scales a row that is wider than the view so that all of it is seen', () => {
    const row = layoutRow(
      Array.from({ length: 4 }, () => ({ width: 500, height: 100 })),
      { x: 0, y: 0 },
      view,
    );

    const left = row[0]!.x;
    const right = row[3]!.x + row[3]!.width;
    expect(right - left).toBeLessThanOrEqual(900.0001);
    expect(row[0]!.width).toBeLessThan(500);
    expect(row[0]!.width / row[0]!.height).toBeCloseTo(5);
  });
});

describe('fileIdOf', () => {
  it('is the same for the same bytes and different for other bytes', async () => {
    const a = await fileIdOf(new Blob([new Uint8Array([1, 2, 3])]));
    const b = await fileIdOf(new Blob([new Uint8Array([1, 2, 3])]));
    const c = await fileIdOf(new Blob([new Uint8Array([1, 2, 4])]));

    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{40}$/);
  });
});
