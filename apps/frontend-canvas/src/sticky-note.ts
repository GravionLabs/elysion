import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';

/** ariadne's light `--c-node-*` accent colors. */
export const STICKY_COLORS = [
  { name: 'Blue', hex: '#3b82f6' },
  { name: 'Teal', hex: '#14b8a6' },
  { name: 'Green', hex: '#22c55e' },
  { name: 'Amber', hex: '#eab308' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Red', hex: '#ef4444' },
  { name: 'Pink', hex: '#ec4899' },
  { name: 'Purple', hex: '#8b5cf6' },
] as const;

export type StickyColor = (typeof STICKY_COLORS)[number];

export const STICKY_SIZE = { width: 200, height: 160 } as const;

/** Mixes `hex` into white, like ariadne's `color-mix(in srgb, <color> 12%, <surface>)` card fill. */
export function tint(hex: string, amount: number): string {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16);
    return Math.round(255 - (255 - value) * amount)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/**
 * A sticky note in the look of ariadne's node cards: a tinted card with a 1px border in the accent
 * color and a bound, centered text. Returned as one rectangle plus its text element; the rectangle
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
      backgroundColor: tint(color.hex, 0.14),
      strokeColor: color.hex,
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
