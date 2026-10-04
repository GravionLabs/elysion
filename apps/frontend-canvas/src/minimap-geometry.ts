export interface SceneRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What the minimap needs to know about the canvas, taken from Excalidraw's onChange. */
export interface SceneSnapshot {
  readonly elements: readonly SceneRect[];
  readonly scrollX: number;
  readonly scrollY: number;
  readonly zoom: number;
  readonly width: number;
  readonly height: number;
}

export interface MinimapLayout {
  /** Minimap pixels per scene unit. */
  readonly scale: number;
  /** Scene coordinates shown at the minimap's top-left corner. */
  readonly originX: number;
  readonly originY: number;
  /** The visible part of the scene, in minimap pixels. */
  readonly viewport: SceneRect;
}

const PADDING = 12;

/** The part of the scene the canvas currently shows (Excalidraw: sceneX = clientX / zoom - scrollX). */
export function viewportInScene(snapshot: SceneSnapshot): SceneRect {
  return {
    x: -snapshot.scrollX,
    y: -snapshot.scrollY,
    width: snapshot.width / snapshot.zoom,
    height: snapshot.height / snapshot.zoom,
  };
}

/** Bounds of all elements and the viewport, so the viewport frame never leaves the minimap. */
export function sceneBounds(snapshot: SceneSnapshot): SceneRect {
  const view = viewportInScene(snapshot);
  let minX = view.x;
  let minY = view.y;
  let maxX = view.x + view.width;
  let maxY = view.y + view.height;
  // A loop, not Math.min(...rects): spreading tens of thousands of elements overflows the call stack.
  for (const element of snapshot.elements) {
    if (element.x < minX) minX = element.x;
    if (element.y < minY) minY = element.y;
    if (element.x + element.width > maxX) maxX = element.x + element.width;
    if (element.y + element.height > maxY) maxY = element.y + element.height;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function computeLayout(
  snapshot: SceneSnapshot,
  size: { width: number; height: number },
): MinimapLayout {
  const bounds = sceneBounds(snapshot);
  const innerWidth = size.width - 2 * PADDING;
  const innerHeight = size.height - 2 * PADDING;
  // A degenerate scene (a lone point, or a canvas of size 0 as in tests) must not give an infinite scale.
  const scale = Math.min(
    innerWidth / Math.max(bounds.width, 1),
    innerHeight / Math.max(bounds.height, 1),
  );
  // Center the scene in the minimap along the axis that has room to spare.
  const originX = bounds.x - (size.width / scale - bounds.width) / 2;
  const originY = bounds.y - (size.height / scale - bounds.height) / 2;
  const view = viewportInScene(snapshot);
  return {
    scale,
    originX,
    originY,
    viewport: {
      x: (view.x - originX) * scale,
      y: (view.y - originY) * scale,
      width: view.width * scale,
      height: view.height * scale,
    },
  };
}

export function toMinimapRect(rect: SceneRect, layout: MinimapLayout): SceneRect {
  return {
    x: (rect.x - layout.originX) * layout.scale,
    y: (rect.y - layout.originY) * layout.scale,
    width: rect.width * layout.scale,
    height: rect.height * layout.scale,
  };
}

/** The scene point under a point in the minimap. */
export function minimapToScene(
  point: { x: number; y: number },
  layout: MinimapLayout,
): { x: number; y: number } {
  return { x: point.x / layout.scale + layout.originX, y: point.y / layout.scale + layout.originY };
}

/** The scroll offsets that put `center` in the middle of the canvas. */
export function scrollToCenter(
  center: { x: number; y: number },
  snapshot: Pick<SceneSnapshot, 'zoom' | 'width' | 'height'>,
): { scrollX: number; scrollY: number } {
  return {
    scrollX: snapshot.width / (2 * snapshot.zoom) - center.x,
    scrollY: snapshot.height / (2 * snapshot.zoom) - center.y,
  };
}
