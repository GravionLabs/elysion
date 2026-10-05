import { describe, expect, it } from 'vitest';
import {
  computeLayout,
  followViewport,
  minimapToScene,
  sceneBounds,
  scrollToCenter,
  toMinimapRect,
  viewportInScene,
  type SceneSnapshot,
} from './minimap-geometry';

const snapshot = (overrides: Partial<SceneSnapshot> = {}): SceneSnapshot => ({
  elements: [{ x: 0, y: 0, width: 100, height: 50 }],
  scrollX: 0,
  scrollY: 0,
  zoom: 1,
  width: 200,
  height: 100,
  ...overrides,
});

describe('viewportInScene', () => {
  it('maps scroll and zoom to the visible scene rectangle', () => {
    expect(viewportInScene(snapshot({ scrollX: -40, scrollY: 10, zoom: 2 }))).toEqual({
      x: 40,
      y: -10,
      width: 100,
      height: 50,
    });
  });
});

describe('sceneBounds', () => {
  it('covers the elements and the viewport when the content is large', () => {
    const bounds = sceneBounds(
      snapshot({ elements: [{ x: 0, y: 0, width: 5000, height: 3000 }], scrollX: -300 }),
    );
    // The viewport (200x100 at x=300) lies inside the element, so the element decides.
    expect(bounds.x).toBeCloseTo(0);
    expect(bounds.y).toBeCloseTo(0);
    expect(bounds.width).toBe(5000);
    expect(bounds.height).toBe(3000);
  });

  it('is at least two viewports wide and high around the middle of what is shown', () => {
    const bounds = sceneBounds(snapshot({ scrollX: -300 }));
    // Viewport 200x100 at x=300 and an element 100x50 at the origin span 500x100, below the minimum height.
    expect(bounds.width).toBe(500);
    expect(bounds.height).toBe(200);
    expect(bounds.y + bounds.height / 2).toBeCloseTo(50);
  });
});

describe('computeLayout', () => {
  const size = { width: 160, height: 120 };

  it('fits the bounds into the minimap with padding and keeps the viewport inside', () => {
    const layout = computeLayout(snapshot({ scrollX: -300 }), size);
    const { viewport } = layout;
    expect(viewport.x).toBeGreaterThanOrEqual(0);
    expect(viewport.y).toBeGreaterThanOrEqual(0);
    expect(viewport.x + viewport.width).toBeLessThanOrEqual(size.width);
    expect(viewport.y + viewport.height).toBeLessThanOrEqual(size.height);
    expect(layout.scale).toBeCloseTo((160 - 24) / 500);
  });

  it('draws elements at the same scale as the viewport', () => {
    const snap = snapshot();
    const layout = computeLayout(snap, size);
    const element = toMinimapRect(snap.elements[0], layout);
    expect(element.width / layout.viewport.width).toBeCloseTo(100 / 200);
  });
});

describe('frame size', () => {
  const size = { width: 160, height: 120 };

  it('stays at most half the minimap when the content is small', () => {
    const { viewport } = computeLayout(snapshot(), size);
    expect(viewport.width).toBeLessThanOrEqual(size.width / 2 + 0.001);
    expect(viewport.height).toBeLessThanOrEqual(size.height / 2 + 0.001);
  });

  it('is centered on the view, not pushed into a corner', () => {
    const { viewport } = computeLayout(snapshot(), size);
    expect(viewport.x + viewport.width / 2).toBeCloseTo(size.width / 2);
    expect(viewport.y + viewport.height / 2).toBeCloseTo(size.height / 2);
  });

  it('still shrinks when the content outgrows the minimum extent', () => {
    const wide = computeLayout(
      snapshot({ elements: [{ x: 0, y: 0, width: 5000, height: 3000 }] }),
      size,
    );
    const small = computeLayout(snapshot(), size);
    expect(wide.viewport.width).toBeLessThan(small.viewport.width);
  });
});

describe('large scenes', () => {
  it('handles far more elements than a spread into Math.min could take', () => {
    const elements = Array.from({ length: 300_000 }, (_, index) => ({
      x: index,
      y: index % 1000,
      width: 10,
      height: 10,
    }));
    const bounds = sceneBounds(snapshot({ elements }));
    expect(bounds.width).toBeGreaterThan(299_000);
  });
});

describe('degenerate scenes', () => {
  it('keeps a finite scale when everything has size zero', () => {
    const layout = computeLayout(
      snapshot({ elements: [{ x: 5, y: 5, width: 0, height: 0 }], width: 0, height: 0 }),
      { width: 160, height: 120 },
    );
    expect(Number.isFinite(layout.scale)).toBe(true);
    expect(Number.isFinite(layout.originX)).toBe(true);
  });
});

describe('followViewport', () => {
  it('keeps scale and origin but moves the frame to the new view', () => {
    const size = { width: 160, height: 120 };
    const start = snapshot();
    const layout = computeLayout(start, size);
    const moved = snapshot({ scrollX: -50, scrollY: -20 });

    const followed = followViewport(layout, moved);

    expect(followed.scale).toBe(layout.scale);
    expect(followed.originX).toBe(layout.originX);
    expect(followed.originY).toBe(layout.originY);
    expect(followed.viewport.x).toBeCloseTo(layout.viewport.x + 50 * layout.scale);
    expect(followed.viewport.y).toBeCloseTo(layout.viewport.y + 20 * layout.scale);
    expect(followed.viewport.width).toBeCloseTo(layout.viewport.width);
  });
});

describe('panning', () => {
  it('turns a minimap point into the scene point and a scroll that centers it', () => {
    const snap = snapshot({ zoom: 2 });
    const layout = computeLayout(snap, { width: 160, height: 120 });
    const target = { x: 80, y: 60 };
    const scene = minimapToScene(target, layout);

    const { scrollX, scrollY } = scrollToCenter(scene, snap);
    const centered = viewportInScene({ ...snap, scrollX, scrollY });
    expect(centered.x + centered.width / 2).toBeCloseTo(scene.x);
    expect(centered.y + centered.height / 2).toBeCloseTo(scene.y);
  });

  it('round-trips a scene point through the minimap', () => {
    const layout = computeLayout(snapshot(), { width: 160, height: 120 });
    const rect = toMinimapRect({ x: 30, y: 20, width: 0, height: 0 }, layout);
    const back = minimapToScene({ x: rect.x, y: rect.y }, layout);
    expect(back.x).toBeCloseTo(30);
    expect(back.y).toBeCloseTo(20);
  });
});
