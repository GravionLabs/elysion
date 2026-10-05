import { describe, expect, it } from 'vitest';
import { IDENTITY_COLORS, createSessionIdentity, hashOf, identityFor } from './identity';
import { STICKY_COLORS } from '../sticky-note';

describe('identityFor', () => {
  it('gives the same id the same name and color every time', () => {
    expect(identityFor('abc')).toEqual(identityFor('abc'));
    expect(identityFor('abc')).toEqual({
      id: 'abc',
      name: expect.any(String),
      color: expect.any(String),
    });
  });

  it('picks the color from the design tokens palette', () => {
    for (const id of ['a', 'b', 'c', crypto.randomUUID(), crypto.randomUUID(), 'ünï']) {
      expect(IDENTITY_COLORS).toContain(identityFor(id).color);
    }
    expect(IDENTITY_COLORS).toEqual(STICKY_COLORS.map((c) => c.hex));
  });

  it('names a guest with four digits', () => {
    expect(identityFor('abc').name).toMatch(/^Guest [1-9]\d{3}$/);
  });

  it('spreads ids over the palette instead of giving everyone one color', () => {
    const colors = new Set(Array.from({ length: 200 }, (_, i) => identityFor(`id-${i}`).color));

    expect(colors.size).toBe(IDENTITY_COLORS.length);
  });
});

describe('createSessionIdentity', () => {
  it('makes a new id each time, and the color and name follow from it', () => {
    const first = createSessionIdentity();
    const second = createSessionIdentity();

    expect(first.id).not.toBe(second.id);
    expect(first).toEqual(identityFor(first.id));
  });
});

describe('hashOf', () => {
  it('is stable and not zero for text', () => {
    expect(hashOf('elysion')).toBe(hashOf('elysion'));
    expect(hashOf('elysion')).not.toBe(hashOf('elysioN'));
  });
});
