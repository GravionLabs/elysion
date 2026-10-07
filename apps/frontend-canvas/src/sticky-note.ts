import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';

/** ariadne's light `--c-node-*` accent colors, yellow first: it is the color of the first note. */
export const STICKY_COLORS = [
  { name: 'Yellow', hex: '#eab308' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Red', hex: '#ef4444' },
  { name: 'Pink', hex: '#ec4899' },
  { name: 'Purple', hex: '#8b5cf6' },
  { name: 'Blue', hex: '#3b82f6' },
  { name: 'Teal', hex: '#14b8a6' },
  { name: 'Green', hex: '#22c55e' },
] as const;

export type StickyColor = (typeof STICKY_COLORS)[number];

/** The color a note has when nothing else says: yellow. */
export const DEFAULT_STICKY_COLOR: StickyColor = STICKY_COLORS[0];

export const STICKY_SIZE = { width: 200, height: 160 } as const;

/** Mixes `hex` into white: `amount` is how much of the color is left (1 is the color, 0 is white). */
export function tint(hex: string, amount: number): string {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16);
    return Math.round(255 - (255 - value) * amount)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/** Mixes `hex` into black: `amount` is how much black is added (0 is the color, 1 is black). */
export function shade(hex: string, amount: number): string {
  const channel = (offset: number) =>
    Math.round(parseInt(hex.slice(offset, offset + 2), 16) * (1 - amount))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/**
 * What Excalidraw's dark theme does to every color on the canvas: a CSS filter, `invert(93%) hue-rotate(180deg)`
 * (the canvas elements carry `filter: var(--theme-filter)`). Light colors turn dark, the hue stays. A note's stored
 * paper is the same in both themes (it is shared by everybody on the board), so in the dark theme it is *drawn* in
 * the color this function gives.
 */
export function darkThemeColor(hex: string): string {
  const invert = (value: number) => value * (1 - 0.93) + (255 - value) * 0.93;
  const [r, g, b] = [1, 3, 5].map((offset) => invert(parseInt(hex.slice(offset, offset + 2), 16)));
  // The matrix of hue-rotate(180deg).
  const out = [
    -0.574 * r + 1.43 * g + 0.144 * b,
    0.426 * r + 0.43 * g + 0.144 * b,
    0.426 * r + 1.43 * g - 0.856 * b,
  ].map((value) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0'),
  );
  return `#${out.join('')}`;
}

/**
 * The color as it is seen on the canvas in a theme: what the toolbar's note icon and color swatches show, so that
 * the menu and the note that is drawn look the same. The same in the light theme, filtered in the dark one.
 */
export function seenColor(hex: string, theme: 'light' | 'dark'): string {
  return theme === 'dark' ? darkThemeColor(hex) : hex;
}

/** The paper of a note: its background, the color as a note on a wall (the text stays dark and readable). */
export function paperColor(color: StickyColor): string {
  return tint(color.hex, 0.55);
}

/** The border of a note: a darker shade of the same hue. */
export function borderColor(color: StickyColor): string {
  return shade(color.hex, 0.2);
}

/**
 * A sticky note: a card whose background is the chosen color (paper), with a 1px border in a darker
 * shade of it and a bound, centered text. Returned as one rectangle plus its text element; the rectangle
 * (first element) is the container to select.
 */
export function createStickyNote(
  color: StickyColor,
  center: { x: number; y: number },
): readonly ExcalidrawElement[] {
  return convertToExcalidrawElements([
    {
      type: 'rectangle',
      x: center.x - STICKY_SIZE.width / 2,
      y: center.y - STICKY_SIZE.height / 2,
      width: STICKY_SIZE.width,
      height: STICKY_SIZE.height,
      backgroundColor: paperColor(color),
      strokeColor: borderColor(color),
      strokeWidth: 1,
      fillStyle: 'solid',
      roughness: 0,
      roundness: { type: 3 },
      label: {
        text: 'Note',
        fontSize: 20,
        fontFamily: 2,
        strokeColor: '#1a1c23',
        textAlign: 'center',
        verticalAlign: 'middle',
      },
    },
  ]);
}
