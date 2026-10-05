import { describe, expect, it } from 'vitest';
import {
  IDENTITY_COLORS,
  MAX_NAME_LENGTH,
  createSessionIdentity,
  hashOf,
  identityFor,
  withHostIdentity,
} from './identity';
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

describe('withHostIdentity', () => {
  const session = identityFor('abc');

  it('keeps the session identity when the host asks for nothing', () => {
    expect(withHostIdentity(session, undefined, undefined)).toEqual(session);
  });

  it('uses the name and color the host gives, and keeps the id', () => {
    expect(withHostIdentity(session, ' Ada ', '#14b8a6')).toEqual({
      id: 'abc',
      name: 'Ada',
      color: '#14b8a6',
    });
  });

  it('ignores a blank name and a color that is not #rrggbb', () => {
    for (const color of ['red', '#fff', 'url(x)', '']) {
      expect(withHostIdentity(session, '   ', color)).toEqual(session);
    }
  });

  it('cuts a long name', () => {
    expect(withHostIdentity(session, 'x'.repeat(500), undefined).name).toHaveLength(
      MAX_NAME_LENGTH,
    );
  });
});
