/**
 * The grid is drawn as dots in the background of the board, by CSS, not by Excalidraw (which draws lines and ties drawing to
 * snapping, see the spec's "The grid"). The static canvas is transparent, so the `.excalidraw` container's background shows
 * through; `canvas.css` paints the dots from three custom properties that this module computes from the view.
 */

/** Dots closer than this (in screen pixels) would be a haze, not a grid: they fade out. */
export const MIN_DOT_SPACING = 8;

export interface GridView {
  /** Excalidraw's `appState.zoom.value`. */
  zoom: number;
  /** `appState.scrollX` and `scrollY`: the scene's offset in scene units, before the zoom. */
  scrollX: number;
  scrollY: number;
  /** The grid size in scene units (10, 20 or 40). */
  size: number;
}

export interface GridDots {
  /** Spacing of the dots on the screen, in pixels. */
  spacing: number;
  /** Where the tile starts, so that a dot sits on every multiple of the size in scene coordinates. */
  offsetX: number;
  offsetY: number;
  /** False when the dots would be closer than {@link MIN_DOT_SPACING}. */
  visible: boolean;
}

/**
 * A dot sits at the screen position `(k * size + scroll) * zoom` for every whole `k`. The background tile has its dot in the
 * middle, so the tile starts half a spacing before that.
 */
export function gridDots({ zoom, scrollX, scrollY, size }: GridView): GridDots {
  const spacing = size * zoom;
  const origin = (scroll: number) => {
    const shifted = (scroll * zoom - spacing / 2) % spacing;
    return shifted < 0 ? shifted + spacing : shifted;
  };
  return {
    spacing,
    offsetX: origin(scrollX),
    offsetY: origin(scrollY),
    visible: spacing >= MIN_DOT_SPACING,
  };
}

/** Puts the dots on the element that carries the background (a custom property each, so React does not re-render for a scroll). */
export function applyGridDots(element: HTMLElement, view: GridView): void {
  const dots = gridDots(view);
  element.style.setProperty('--grid-spacing', `${dots.spacing}px`);
  element.style.setProperty('--grid-offset-x', `${dots.offsetX}px`);
  element.style.setProperty('--grid-offset-y', `${dots.offsetY}px`);
  element.toggleAttribute('data-grid-faded', !dots.visible);
}
