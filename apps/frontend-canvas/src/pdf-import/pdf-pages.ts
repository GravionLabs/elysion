/**
 * What a PDF becomes on a board (#725): one picture per chosen page, each in a frame named after its page, the frames in a
 * grid around the middle of the view. This file is the arithmetic and the limits; pdf.js and the canvas are elsewhere.
 */

/** The most pages one import takes. */
export const MAX_PDF_PAGES = 50;

/** The largest PDF file taken (the object store keeps pictures, never the PDF: the file is read in the browser). */
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

/** The widths, in pixels, a page can be rendered at; the first of the default is what a screen shows sharply. */
export const WIDTH_CHOICES = [800, 1200, 1600, 2400] as const;
export const DEFAULT_WIDTH = 1600;

/** A page is as wide as this on the board (scene units), whatever its pixels: the pixels only decide how sharp it is. */
export const PAGE_BOARD_WIDTH = 800;

/** The space between two frames. */
export const GRID_GAP = 80;

/** The tallest picture rendered, in pixels: a poster or a scroll of a page must not make a canvas the browser refuses. */
export const MAX_PAGE_PIXELS_HIGH = 8000;

export function isPdf(file: Blob & { name?: string }): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name ?? '');
}

/** The size in pixels to render a page of the given proportions at `width`, no higher than {@link MAX_PAGE_PIXELS_HIGH}. */
export function renderSize(aspect: number, width: number): { width: number; height: number } {
  const height = Math.round(width * aspect);
  if (height <= MAX_PAGE_PIXELS_HIGH) return { width, height };
  return { width: Math.round(MAX_PAGE_PIXELS_HIGH / aspect), height: MAX_PAGE_PIXELS_HIGH };
}

/** How many columns a grid of `count` pages has: about as wide as high, at most four. */
export function columnsFor(count: number): number {
  return Math.min(4, Math.max(1, Math.ceil(Math.sqrt(count))));
}

export interface Cell {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The frames of pages in a grid, row by row, centered on `center`. Every page is {@link PAGE_BOARD_WIDTH} wide and as high as
 * its proportions say (`aspects` are height over width); a row is as high as its highest page, its pages start at the top.
 */
export function gridCells(aspects: readonly number[], center: { x: number; y: number }): Cell[] {
  const columns = columnsFor(aspects.length);
  const heights = aspects.map((aspect) => PAGE_BOARD_WIDTH * aspect);
  const rows: number[][] = [];
  aspects.forEach((_, index) => {
    (rows[Math.floor(index / columns)] ??= []).push(index);
  });
  const rowHeights = rows.map((row) => Math.max(...row.map((index) => heights[index]!)));
  const totalHeight = rowHeights.reduce((sum, h) => sum + h, 0) + GRID_GAP * (rows.length - 1);
  const usedColumns = Math.min(columns, aspects.length);
  const totalWidth = usedColumns * PAGE_BOARD_WIDTH + GRID_GAP * (usedColumns - 1);
  const left = center.x - totalWidth / 2;
  let top = center.y - totalHeight / 2;
  const cells: Cell[] = new Array<Cell>(aspects.length);
  rows.forEach((row, rowIndex) => {
    row.forEach((index, column) => {
      cells[index] = {
        x: left + column * (PAGE_BOARD_WIDTH + GRID_GAP),
        y: top,
        width: PAGE_BOARD_WIDTH,
        height: heights[index]!,
      };
    });
    top += rowHeights[rowIndex]! + GRID_GAP;
  });
  return cells;
}

/** The number a frame's name ends in (`Page 3`, `Seite 12`, `3`), or `null`: how the pages of a board are put in order again (#726). */
export function pageNumberOf(name: string | null | undefined): number | null {
  const match = /(\d+)\s*$/.exec(name ?? '');
  return match ? Number(match[1]) : null;
}
