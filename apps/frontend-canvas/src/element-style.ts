import type { AppState } from '@excalidraw/excalidraw/types';

/**
 * Defaults for newly drawn elements: flat and solid like ariadne's node cards instead of
 * Excalidraw's hand-drawn style. Colors are given in light-theme space; Excalidraw's dark theme
 * inverts canvas colors with a filter, so the same values read correctly in both themes.
 */
export const ELEMENT_DEFAULTS: Partial<AppState> = {
  currentItemRoughness: 0,
  currentItemFillStyle: 'solid',
  currentItemStrokeWidth: 1,
  currentItemRoundness: 'round',
  currentItemStrokeColor: '#1a1c23',
  currentItemBackgroundColor: 'transparent',
  // Helvetica, the closest of Excalidraw's bundled families to ariadne's system-ui.
  currentItemFontFamily: 2,
  // Arrows are connectors: right-angled, with an arrowhead at the end only (see connector.ts).
  currentItemArrowType: 'elbow',
  currentItemStartArrowhead: null,
  currentItemEndArrowhead: 'arrow',
};

/** Canvas background; ariadne's light `--c-bg`. */
export const VIEW_BACKGROUND_COLOR = '#f4f5f7';
