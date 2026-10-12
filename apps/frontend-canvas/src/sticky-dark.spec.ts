import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DARK_NODE_COLORS,
  STICKY_COLOR_PAIRS,
  preImage,
  reachableShade,
  recolor,
  sceneToStored,
  seenColor,
  seenInDark,
  storedToScene,
} from './sticky-dark';
import { STICKY_COLORS, borderColor, darkThemeColor, paperColor, shade } from './sticky-note';

const channels = (hex: string) =>
  [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
const distance = (a: string, b: string) =>
  Math.max(...channels(a).map((value, index) => Math.abs(value - channels(b)[index])));

describe('the dark scene colors of the sticky notes', () => {
  it('has the dark tokens of packages/design-tokens', () => {
    const css = readFileSync(
      join(process.cwd(), '../../packages/design-tokens/tokens.css'),
      'utf8',
    );
    const dark = css.slice(css.lastIndexOf('--c-node-red'));
    const names: Record<string, string> = {
      Yellow: 'amber',
      Orange: 'orange',
      Red: 'red',
      Pink: 'pink',
      Purple: 'purple',
      Blue: 'blue',
      Teal: 'teal',
      Green: 'green',
    };
    for (const color of STICKY_COLORS) {
      const token = new RegExp(`--c-node-${names[color.name]}:\\s*(#[0-9a-f]{6})`).exec(dark)![1];
      expect(DARK_NODE_COLORS[color.name]).toBe(token);
    }
  });

  it('has a pair for the paper and the border of every note color', () => {
    expect(STICKY_COLOR_PAIRS).toHaveLength(STICKY_COLORS.length * 2);
    for (const color of STICKY_COLORS) {
      expect(storedToScene(paperColor(color))).not.toBe(paperColor(color));
      expect(storedToScene(borderColor(color))).not.toBe(borderColor(color));
    }
  });

  it('comes out of the dark theme filter as the wanted color, within a few steps per channel', () => {
    for (const color of STICKY_COLORS) {
      const token = DARK_NODE_COLORS[color.name];
      // A bright saturated token (yellow, orange, teal, green) is out of the filter's reach: its least darker shade stands in.
      expect(distance(seenInDark(borderColor(color)), reachableShade(token))).toBeLessThanOrEqual(
        6,
      );
      expect(distance(seenInDark(paperColor(color)), shade(token, 0.62))).toBeLessThanOrEqual(6);
    }
  });

  it('keeps the border bright and in the hue of the token', () => {
    for (const color of STICKY_COLORS) {
      const border = channels(seenInDark(borderColor(color)));
      const token = channels(DARK_NODE_COLORS[color.name]);
      expect(border.indexOf(Math.max(...border))).toBe(token.indexOf(Math.max(...token)));
      expect(Math.max(...border)).toBeGreaterThanOrEqual(Math.max(...token) * 0.55);
    }
  });

  it('reads as the color of the note: the hue of the dark token is kept', () => {
    // The paper is a deep shade of the dark token: its brightest channel is the token's.
    for (const color of STICKY_COLORS) {
      const paper = channels(seenInDark(paperColor(color)));
      const token = channels(DARK_NODE_COLORS[color.name]);
      expect(paper.indexOf(Math.max(...paper))).toBe(token.indexOf(Math.max(...token)));
    }
  });

  it('is a round trip: stored → scene → stored, and the two sets share no color', () => {
    const stored = new Set(STICKY_COLOR_PAIRS.map((pair) => pair.stored));
    const scene = new Set(STICKY_COLOR_PAIRS.map((pair) => pair.scene));
    expect(stored.size).toBe(16);
    expect(scene.size).toBe(16);
    for (const color of scene) expect(stored.has(color)).toBe(false);
    for (const pair of STICKY_COLOR_PAIRS) {
      expect(sceneToStored(storedToScene(pair.stored))).toBe(pair.stored);
      expect(storedToScene(sceneToStored(pair.scene))).toBe(pair.scene);
    }
  });

  it('leaves every other color as it is, in both directions, whatever the case', () => {
    for (const color of ['#1a1c23', '#ffffff', 'transparent', '#EAB308', 'red', '']) {
      expect(storedToScene(color)).toBe(color);
      expect(sceneToStored(color)).toBe(color);
    }
    expect(storedToScene(paperColor(STICKY_COLORS[0]).toUpperCase())).toBe(
      storedToScene(paperColor(STICKY_COLORS[0])),
    );
  });

  it('works a color back through the filter', () => {
    expect(distance(darkThemeColor(preImage('#336699')), '#336699')).toBeLessThanOrEqual(2);
  });

  it('shows the stored color in the light theme and the drawn one in the dark theme', () => {
    const paper = paperColor(STICKY_COLORS[0]);
    expect(seenColor(paper, 'light')).toBe(paper);
    expect(seenColor(paper, 'dark')).toBe(seenInDark(paper));
    expect(seenColor('#f3d578', 'dark')).toBe(darkThemeColor('#f3d578')); // not a note color: the filter alone
  });
});

describe('recolor', () => {
  const note = {
    id: 'a',
    version: 3,
    versionNonce: 7,
    backgroundColor: paperColor(STICKY_COLORS[0]),
    strokeColor: borderColor(STICKY_COLORS[0]),
  };

  it('returns the very same object when nothing changes', () => {
    const other = {
      id: 'b',
      version: 1,
      versionNonce: 2,
      backgroundColor: 'transparent',
      strokeColor: '#1a1c23',
    };
    const [out] = recolor([other], storedToScene);
    expect(out).toBe(other);
  });

  it('copies a changed element with the same version and does not touch the original', () => {
    const [out] = recolor([note], storedToScene);
    expect(out).not.toBe(note);
    expect(out.version).toBe(3);
    expect(out.versionNonce).toBe(7);
    expect(out.backgroundColor).toBe(storedToScene(note.backgroundColor));
    expect(note.backgroundColor).toBe(paperColor(STICKY_COLORS[0]));
    expect(recolor([out], sceneToStored)[0]).toEqual(note);
  });

  it('keeps an element without colors without colors', () => {
    const [out] = recolor([{ id: 'c' } as { id: string; backgroundColor?: string }], storedToScene);
    expect('backgroundColor' in out).toBe(false);
  });
});
