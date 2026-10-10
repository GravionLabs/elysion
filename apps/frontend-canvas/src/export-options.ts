/**
 * What the Export menu can ask for (#726). All of it is optional, and what is left out is what the export did before: the
 * whole board on one page, on its background, in the colors on the screen, at the size of the content.
 */
export type ExportTheme = 'current' | 'light' | 'dark';
/** A PDF of a board with frames: one page per frame (`auto`), or the whole board on one page (`whole`). */
export type PdfPages = 'auto' | 'whole';
export type PageFormat = 'fit' | 'a4' | 'letter';
export type PageOrientation = 'auto' | 'portrait' | 'landscape';

export interface ExportOptions {
  /** Export only what is selected (with the text bound to selected shapes). */
  selectionOnly?: boolean;
  /** Paint the board's background (default) or leave it transparent. */
  background?: boolean;
  /** `light` or `dark` whatever the screen shows; `current` (default) keeps what it shows. */
  theme?: ExportTheme;
  /** The size of a PNG: 1 (default), 2 or 3 pixels per unit of the board. */
  scale?: 1 | 2 | 3;
  /** For a PDF of a board that has frames. */
  pdfPages?: PdfPages;
  /** The page of a PDF: the size of the content (default), A4 or Letter. */
  pageFormat?: PageFormat;
  /** `auto` (default) turns the page the way the content is shaped. */
  orientation?: PageOrientation;
}

/** The part of a frame that its order depends on. */
export interface FrameLike {
  id: string;
  name?: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The number a frame's name ends in (`Page 3`, `Seite 12`, `3`), or `null`. */
export function pageNumberOf(name: string | null | undefined): number | null {
  const match = /(\d+)\s*$/.exec(name ?? '');
  return match ? Number(match[1]) : null;
}

/**
 * The frames of a board in the order of its pages: by the number in their names when **every** frame has one (the pages of an
 * imported PDF are `Page 1`, `Page 2`, ...), otherwise by position, row by row from the top and left to right within a row
 * (two frames are in one row when their tops differ by less than half the height of the lower one). A tie is broken by position.
 */
export function framesInOrder<T extends FrameLike>(frames: readonly T[]): T[] {
  const byPosition = (a: T, b: T) => {
    const sameRow = Math.abs(a.y - b.y) < Math.min(a.height, b.height) / 2;
    return sameRow ? a.x - b.x : a.y - b.y;
  };
  const numbered = frames.every((frame) => pageNumberOf(frame.name) !== null);
  return [...frames].sort((a, b) =>
    numbered ? pageNumberOf(a.name)! - pageNumberOf(b.name)! || byPosition(a, b) : byPosition(a, b),
  );
}
