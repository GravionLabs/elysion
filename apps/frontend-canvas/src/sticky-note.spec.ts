import { describe, expect, it } from 'vitest';
import { ELEMENT_DEFAULTS } from './element-style';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE,
  borderColor,
  createStickyNote,
  darkThemeColor,
  paperColor,
  seenColor,
  shade,
  tint,
} from './sticky-note';

describe('tint', () => {
  it('mixes a color into white', () => {
    expect(tint('#000000', 0)).toBe('#ffffff');
    expect(tint('#000000', 1)).toBe('#000000');
    expect(tint('#3b82f6', 0.14)).toBe('#e4eefe');
  });
});

describe('shade', () => {
  it('mixes a color into black', () => {
    expect(shade('#ffffff', 0)).toBe('#ffffff');
    expect(shade('#ffffff', 1)).toBe('#000000');
    expect(shade('#eab308', 0.2)).toBe('#bb8f06');
  });
});

describe('the colors of a note', () => {
  it('start with yellow, which is the default', () => {
    expect(STICKY_COLORS[0].name).toBe('Yellow');
    expect(DEFAULT_STICKY_COLOR).toBe(STICKY_COLORS[0]);
  });

  it('give a light paper and a darker border of the same hue, for every color', () => {
    for (const color of STICKY_COLORS) {
      const lightness = (hex: string) =>
        [1, 3, 5].reduce((sum, offset) => sum + parseInt(hex.slice(offset, offset + 2), 16), 0);
      expect(lightness(paperColor(color)), color.name).toBeGreaterThan(lightness(color.hex));
      expect(lightness(borderColor(color)), color.name).toBeLessThan(lightness(color.hex));
    }
  });

  it('are all different, so a note can be told from its color', () => {
    const papers = STICKY_COLORS.map(paperColor);
    expect(new Set(papers).size).toBe(papers.length);
  });
});

describe('createStickyNote', () => {
  const [card, label] = createStickyNote(STICKY_COLORS[0], { x: 100, y: 50 });

  it('creates a flat, rounded card with the color as its background and a darker border, centered on the point', () => {
    expect(card).toMatchObject({
      type: 'rectangle',
      roughness: 0,
      fillStyle: 'solid',
      strokeWidth: 1,
      strokeColor: borderColor(STICKY_COLORS[0]),
      backgroundColor: paperColor(STICKY_COLORS[0]),
      width: STICKY_SIZE.width,
      height: STICKY_SIZE.height,
    });
    expect(card.roundness).not.toBeNull();
    expect(card.x + card.width / 2).toBe(100);
    expect(card.y + card.height / 2).toBe(50);
  });

  it('binds a centered, non-handwritten text to the card', () => {
    expect(label).toMatchObject({
      type: 'text',
      containerId: card.id,
      fontFamily: 2,
      textAlign: 'center',
      verticalAlign: 'middle',
    });
    expect(card.boundElements).toContainEqual({ id: label.id, type: 'text' });
  });
});

describe('ELEMENT_DEFAULTS', () => {
  it('draws new shapes flat and solid instead of hand-drawn', () => {
    expect(ELEMENT_DEFAULTS).toMatchObject({
      currentItemRoughness: 0,
      currentItemFillStyle: 'solid',
      currentItemRoundness: 'round',
    });
  });

  it('draws arrows as right-angled connectors with an arrowhead at the end only', () => {
    expect(ELEMENT_DEFAULTS).toMatchObject({
      currentItemArrowType: 'elbow',
      currentItemStartArrowhead: null,
      currentItemEndArrowhead: 'arrow',
    });
  });
});

describe('the colors as they are seen on the canvas', () => {
  it('is the same color in the light theme', () => {
    for (const color of STICKY_COLORS) {
      expect(seenColor(paperColor(color), 'light')).toBe(paperColor(color));
    }
  });

  it('is what the dark theme filter makes of it: light colors turn dark, the hue stays', () => {
    // invert(93%) hue-rotate(180deg) of the yellow paper, worked out by hand.
    expect(darkThemeColor('#f3d577')).toBe('#503700');
    expect(seenColor('#f3d577', 'dark')).toBe('#503700');
    expect(darkThemeColor('#ffffff')).toBe('#121212'); // white becomes the near-black of the dark canvas
    expect(darkThemeColor('#000000')).toBe('#ededed');
  });

  it('keeps the hue of every note color, only the lightness changes', () => {
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b);
      const d = max - Math.min(r, g, b);
      if (d === 0) return 0;
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    for (const color of STICKY_COLORS) {
      const light = hue(paperColor(color));
      const dark = hue(darkThemeColor(paperColor(color)));
      expect(Math.abs(light - dark) % 360).toBeLessThan(10);
    }
  });
});
