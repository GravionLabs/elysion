// Excalidraw's own zoom limits and step (its ZOOM_STEP is 0.1, the zoom is clamped to 0.1..30).
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 30;
export const ZOOM_STEP = 0.1;

export interface View {
  scrollX: number;
  scrollY: number;
  /** The zoom factor, 1 is 100%. */
  zoom: number;
  /** The size of the canvas in screen pixels. */
  width: number;
  height: number;
}

/** `value` clamped to Excalidraw's limits and rounded to two decimals, like its own zoom. */
export function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100));
}

/**
 * The zoom and scroll that show the same scene point in the middle of the canvas at a new zoom
 * (Excalidraw scrolls by scene units: a scene point `p` is at `(p + scroll) * zoom` on screen).
 */
export function zoomAbout(
  view: View,
  value: number,
): { zoom: number; scrollX: number; scrollY: number } {
  const zoom = clampZoom(value);
  return {
    zoom,
    scrollX: view.scrollX + view.width / 2 / zoom - view.width / 2 / view.zoom,
    scrollY: view.scrollY + view.height / 2 / zoom - view.height / 2 / view.zoom,
  };
}
