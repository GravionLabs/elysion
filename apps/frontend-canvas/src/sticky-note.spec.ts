import { describe, expect, it } from 'vitest';
import { ELEMENT_DEFAULTS } from './element-style';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE,
  borderColor,
  createStickyNote,
  paperColor,
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
