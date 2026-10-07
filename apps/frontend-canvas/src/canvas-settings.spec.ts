import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID, GRID_KEYS, readGridSettings, writeGridSettings } from './canvas-settings';

/** A minimal in-memory `Storage`. */
function memory(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  } as unknown as Storage;
}

const throwing = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
} as unknown as Storage;

describe('grid settings', () => {
  it('start as: grid hidden, not snapping, 20 px', () => {
    expect(DEFAULT_GRID).toEqual({ show: false, snap: false, size: 20 });
    expect(readGridSettings(memory())).toEqual(DEFAULT_GRID);
  });

  it('are stored and read back', () => {
    const store = memory();

    writeGridSettings({ show: true, snap: true, size: 40 }, store);

    expect(readGridSettings(store)).toEqual({ show: true, snap: true, size: 40 });
  });

  it('fall back to 20 px for a size that is not offered, and to false for anything but "true"', () => {
    const store = memory({
      [GRID_KEYS.size]: '33',
      [GRID_KEYS.show]: 'yes',
      [GRID_KEYS.snap]: '1',
    });

    expect(readGridSettings(store)).toEqual(DEFAULT_GRID);
  });

  it('use the defaults without storage, and survive a storage that throws', () => {
    expect(readGridSettings(null)).toEqual(DEFAULT_GRID);
    expect(readGridSettings(throwing)).toEqual(DEFAULT_GRID);
    expect(() => writeGridSettings({ show: true, snap: false, size: 10 }, throwing)).not.toThrow();
    expect(() => writeGridSettings({ show: true, snap: false, size: 10 }, null)).not.toThrow();
  });
});
