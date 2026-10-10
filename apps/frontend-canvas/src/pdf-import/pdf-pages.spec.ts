import { describe, expect, it } from 'vitest';
import {
  GRID_GAP,
  MAX_PAGE_PIXELS_HIGH,
  PAGE_BOARD_WIDTH,
  columnsFor,
  gridCells,
  isPdf,
  pageNumberOf,
  renderSize,
} from './pdf-pages';

describe('isPdf', () => {
  it('knows a PDF by its type or its name', () => {
    expect(isPdf(new File([], 'a.bin', { type: 'application/pdf' }))).toBe(true);
    expect(isPdf(new File([], 'Report.PDF', { type: '' }))).toBe(true);
    expect(isPdf(new File([], 'a.png', { type: 'image/png' }))).toBe(false);
  });
});

describe('renderSize', () => {
  it('keeps the width and gives the height of the proportions', () => {
    expect(renderSize(Math.SQRT2, 1600)).toEqual({ width: 1600, height: 2263 });
  });

  it('shrinks a page that would be too tall, keeping its proportions', () => {
    const size = renderSize(10, 1600);

    expect(size.height).toBe(MAX_PAGE_PIXELS_HIGH);
    expect(size.width).toBe(800);
  });
});

describe('columnsFor', () => {
  it.each([
    [1, 1],
    [2, 2],
    [4, 2],
    [5, 3],
    [9, 3],
    [10, 4],
    [50, 4],
  ])('%i pages have %i columns', (count, columns) => {
    expect(columnsFor(count)).toBe(columns);
  });
});

describe('gridCells', () => {
  it('puts one page around the center', () => {
    const [cell] = gridCells([1.5], { x: 1000, y: 500 });

    expect(cell).toEqual({
      x: 600,
      y: 500 - (PAGE_BOARD_WIDTH * 1.5) / 2,
      width: 800,
      height: 1200,
    });
  });

  it('puts pages in rows, row by row, with a gap, and the whole grid around the center', () => {
    const cells = gridCells([1, 1, 1], { x: 0, y: 0 });

    // 3 pages: 2 columns, 2 rows
    expect(cells[1]!.x - cells[0]!.x).toBe(PAGE_BOARD_WIDTH + GRID_GAP);
    expect(cells[2]!.x).toBe(cells[0]!.x);
    expect(cells[2]!.y - cells[0]!.y).toBe(PAGE_BOARD_WIDTH + GRID_GAP);
    const left = cells[0]!.x;
    const right = cells[1]!.x + PAGE_BOARD_WIDTH;
    expect(left + right).toBe(0);
  });

  it('lets a row be as high as its highest page and starts the pages of a row at the top', () => {
    const cells = gridCells([1, 2, 1], { x: 0, y: 0 });

    expect(cells[0]!.y).toBe(cells[1]!.y);
    expect(cells[2]!.y).toBe(cells[0]!.y + PAGE_BOARD_WIDTH * 2 + GRID_GAP);
  });

  it('does not overlap any two frames', () => {
    const cells = gridCells(
      Array.from({ length: 11 }, (_, i) => 1 + (i % 3) * 0.3),
      { x: 0, y: 0 },
    );

    for (const [i, a] of cells.entries()) {
      for (const b of cells.slice(i + 1)) {
        const overlaps =
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height;
        expect(overlaps).toBe(false);
      }
    }
  });
});

describe('pageNumberOf', () => {
  it('reads the number a name ends in', () => {
    expect(pageNumberOf('Page 3')).toBe(3);
    expect(pageNumberOf('Seite 12')).toBe(12);
    expect(pageNumberOf('7')).toBe(7);
    expect(pageNumberOf('Intro')).toBeNull();
    expect(pageNumberOf(undefined)).toBeNull();
  });
});
