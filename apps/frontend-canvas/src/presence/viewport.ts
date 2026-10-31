/** The part of the scene a client shows, in scene coordinates (Excalidraw: sceneX = clientX / zoom - scrollX). */
export interface Viewport {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What Excalidraw's `appState` needs to show a viewport. */
export interface ViewTransform {
  readonly scrollX: number;
  readonly scrollY: number;
  readonly zoom: number;
}

/** Excalidraw's own zoom limits. */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 30;

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * A viewport from the awareness or the document, or `null`: it comes from another browser and may hold anything, and a
 * rectangle without area cannot be fitted.
 */
export function parseViewport(value: unknown): Viewport | null {
  const raw = value as Partial<Record<keyof Viewport, unknown>> | null | undefined;
  if (typeof raw !== 'object' || raw === null) return null;
  const { x, y, width, height } = raw;
  if (!isNumber(x) || !isNumber(y) || !isNumber(width) || !isNumber(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

/** The viewport of a canvas with this scroll, zoom and window size. */
export function viewportOf(view: ViewTransform, size: { width: number; height: number }): Viewport {
  return {
    x: 0 - view.scrollX, // not -scrollX: that is -0 for 0
    y: 0 - view.scrollY,
    width: size.width / view.zoom,
    height: size.height / view.zoom,
  };
}

/**
 * The scroll and zoom that show all of `target` in a window of `size`: the aspect ratio is the follower's own, so the
 * zoom is the largest one at which the whole rectangle fits, and the rectangle's middle is the window's middle (the
 * follower sees more of the scene than the person it follows, never less).
 */
export function fitViewport(
  target: Viewport,
  size: { width: number; height: number },
): ViewTransform {
  const fitted = Math.min(size.width / target.width, size.height / target.height);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fitted));
  const centerX = target.x + target.width / 2;
  const centerY = target.y + target.height / 2;
  return {
    zoom,
    scrollX: size.width / (2 * zoom) - centerX,
    scrollY: size.height / (2 * zoom) - centerY,
  };
}

/** Whether two views are the same for practical purposes (a tolerance covers float noise). */
export function sameView(a: ViewTransform, b: ViewTransform): boolean {
  const close = (p: number, q: number) =>
    Math.abs(p - q) < 1e-6 * Math.max(1, Math.abs(p), Math.abs(q));
  return close(a.scrollX, b.scrollX) && close(a.scrollY, b.scrollY) && close(a.zoom, b.zoom);
}

/** Whether two viewports are the same (the awareness is only written when it changed). */
export function sameViewport(a: Viewport | undefined, b: Viewport | undefined): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
