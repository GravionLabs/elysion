import { describe, expect, it } from 'vitest';
import { forgetLegacyGridSettings, readStickyColor, writeStickyColor } from './canvas-settings';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS } from './sticky-note';

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
  removeItem: () => {
    throw new Error('blocked');
  },
} as unknown as Storage;

describe('the grid of a browser before #754', () => {
  it('is forgotten', () => {
    const removed: string[] = [];
    const store = { removeItem: (key: string) => removed.push(key) } as unknown as Storage;

    forgetLegacyGridSettings(store);

    expect(removed).toEqual(['elysion.grid.show', 'elysion.grid.snap', 'elysion.grid.size']);
  });

  it('is left alone without storage and with a storage that throws', () => {
    expect(() => forgetLegacyGridSettings(null)).not.toThrow();
    expect(() => forgetLegacyGridSettings(throwing)).not.toThrow();
  });
});

describe('sticky color', () => {
  it('is yellow until another one was used', () => {
    expect(readStickyColor(memory())).toBe(DEFAULT_STICKY_COLOR);
    expect(DEFAULT_STICKY_COLOR.name).toBe('Yellow');
  });

  it('is stored by name and read back', () => {
    const store = memory();

    writeStickyColor(STICKY_COLORS[6], store);

    expect(readStickyColor(store)).toBe(STICKY_COLORS[6]);
  });

  it('is yellow for a value that is not a color, without storage and with a storage that throws', () => {
    expect(readStickyColor(memory({ 'elysion.sticky.color': 'Mauve' }))).toBe(DEFAULT_STICKY_COLOR);
    expect(readStickyColor(null)).toBe(DEFAULT_STICKY_COLOR);
    expect(readStickyColor(throwing)).toBe(DEFAULT_STICKY_COLOR);
    expect(() => writeStickyColor(STICKY_COLORS[1], throwing)).not.toThrow();
    expect(() => writeStickyColor(STICKY_COLORS[1], null)).not.toThrow();
  });
});
