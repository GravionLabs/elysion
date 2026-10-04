import { describe, expect, it } from 'vitest';
import { ELEMENT_DEFAULTS } from './element-style';
import { STICKY_COLORS, STICKY_SIZE, createStickyNote, tint } from './sticky-note';

describe('tint', () => {
  it('mixes a color into white', () => {
    expect(tint('#000000', 0)).toBe('#ffffff');
    expect(tint('#000000', 1)).toBe('#000000');
    expect(tint('#3b82f6', 0.14)).toBe('#e4eefe');
  });
});

describe('createStickyNote', () => {
  const [card, label] = createStickyNote(STICKY_COLORS[0], { x: 100, y: 50 });

  it('creates a flat, rounded card in the accent color centered on the point', () => {
    expect(card).toMatchObject({
      type: 'rectangle',
      roughness: 0,
      fillStyle: 'solid',
      strokeWidth: 1,
      strokeColor: STICKY_COLORS[0].hex,
      backgroundColor: tint(STICKY_COLORS[0].hex, 0.14),
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
});
