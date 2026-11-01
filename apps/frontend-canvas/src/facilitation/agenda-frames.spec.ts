import { describe, expect, it } from 'vitest';
import { boardFrames, frameViewport, type FrameCandidate } from './agenda-frames';

const frame = (id: string, name: string | null, extra: Partial<FrameCandidate> = {}) => ({
  id,
  type: 'frame',
  name,
  x: 0,
  y: 0,
  width: 200,
  height: 100,
  ...extra,
});

describe('boardFrames (#849)', () => {
  const elements = [
    frame('f1', 'Brainstorm'),
    frame('f2', '  '),
    { ...frame('f3', 'Old'), isDeleted: true },
    { ...frame('m1', 'Magic'), type: 'magicframe' },
    { ...frame('r1', null), type: 'rectangle' },
  ];

  it('lists the live frames by id with their names', () => {
    expect([...boardFrames(elements, {}).frames]).toEqual([
      ['f1', 'Brainstorm'],
      ['f2', null],
      ['m1', 'Magic'],
    ]);
  });

  it('has the selected frame when exactly one is selected, among other elements too', () => {
    expect(boardFrames(elements, { f1: true, r1: true }).selected).toEqual({
      id: 'f1',
      name: 'Brainstorm',
    });
    expect(boardFrames(elements, { f1: true, m1: true }).selected).toBeNull();
    expect(boardFrames(elements, { r1: true }).selected).toBeNull();
    expect(boardFrames(elements, { f3: true }).selected).toBeNull();
  });

  it('changes its key only when the frames or the selected frame change', () => {
    const base = boardFrames(elements, {}).key;
    expect(boardFrames([...elements], { r1: true }).key).toBe(base);
    expect(boardFrames(elements, { f1: true }).key).not.toBe(base);
    expect(boardFrames([frame('f1', 'Renamed'), ...elements.slice(1)], {}).key).not.toBe(base);
  });
});

describe('frameViewport', () => {
  it('is the frame with a margin of 5 % of its longer side', () => {
    expect(frameViewport(frame('f1', null, { x: 100, y: 50 }))).toEqual({
      x: 90,
      y: 40,
      width: 220,
      height: 120,
    });
  });

  it('is null for a frame without area', () => {
    expect(frameViewport(frame('f1', null, { width: 0 }))).toBeNull();
  });
});
