import { describe, expect, it } from 'vitest';
import { framesInOrder, pageNumberOf } from './export-options';

const frame = (id: string, name: string | null, x: number, y: number, w = 100, h = 100) => ({
  id,
  name,
  x,
  y,
  width: w,
  height: h,
});

describe('pageNumberOf', () => {
  it('reads the number a name ends in', () => {
    expect(pageNumberOf('Page 3')).toBe(3);
    expect(pageNumberOf('Seite 12')).toBe(12);
    expect(pageNumberOf('7')).toBe(7);
    expect(pageNumberOf('Intro')).toBeNull();
    expect(pageNumberOf(null)).toBeNull();
  });
});

describe('framesInOrder', () => {
  it('puts numbered frames in the order of their numbers, wherever they are', () => {
    const frames = [
      frame('c', 'Page 10', 0, 0),
      frame('a', 'Page 2', 500, 500),
      frame('b', 'Page 3', 0, 900),
    ];

    expect(framesInOrder(frames).map((f) => f.id)).toEqual(['a', 'b', 'c']);
  });

  it('orders by position when one frame has no number: rows from the top, left to right within a row', () => {
    const frames = [
      frame('bottom-left', 'Notes', 0, 300),
      frame('top-right', 'Plan 1', 300, 0),
      frame('top-left', 'Intro', 0, 10),
      frame('bottom-right', 'Plan 2', 300, 310),
    ];

    expect(framesInOrder(frames).map((f) => f.id)).toEqual([
      'top-left',
      'top-right',
      'bottom-left',
      'bottom-right',
    ]);
  });

  it('treats frames whose tops differ by less than half a height as one row', () => {
    const frames = [frame('b', null, 200, 20), frame('a', null, 0, 0)];

    expect(framesInOrder(frames).map((f) => f.id)).toEqual(['a', 'b']);
  });

  it('breaks a tie of numbers by position and does not change its input', () => {
    const frames = [frame('right', 'Page 1', 300, 0), frame('left', 'Page 1', 0, 0)];

    expect(framesInOrder(frames).map((f) => f.id)).toEqual(['left', 'right']);
    expect(frames.map((f) => f.id)).toEqual(['right', 'left']);
  });
});
