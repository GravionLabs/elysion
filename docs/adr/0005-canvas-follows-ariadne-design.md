# ADR 0005: The canvas follows ariadne's design

- Status: accepted
- Date: 2026-10-04
- Issues: #131, #132, #133, #140
- Pull requests: #146, #147, #148
- Builds on: [ADR 0004](0004-canvas-library.md)

## Context

Excalidraw ships its own look: a hand-drawn style for elements, a tool island at the top and its own
colors. GravionLabs/ariadne has a calmer design (design tokens, a floating pill toolbar at the bottom,
flat node cards) that the team prefers, and the two products should look related.

Excalidraw's UI chrome is DOM and CSS. The elements on the canvas are not: they are drawn with roughjs
onto a `<canvas>`, so their look is element properties.

## Decision

1. **Tokens, not copies of styles.** `src/styles/tokens.css` (since moved to `packages/design-tokens`, see [ADR 0010](0010-shell-controls-the-canvas.md)) holds ariadne's `--c-*` tokens for light and
   dark, scoped to a `.elysion-canvas` root rendered by `CanvasApp` so nothing leaks into the host page.
   `excalidraw-theme.css` maps them onto Excalidraw's CSS custom properties. The scope wins by
   specificity over `.excalidraw` and `.excalidraw.theme--dark`, independent of stylesheet order.
2. **Theme as an input.** A `theme` attribute (`light` or `dark`) on `<elysion-canvas>`, mirrored as an
   input on Angular's `Board`; without it the canvas follows `prefers-color-scheme` live.
3. **A custom bottom toolbar.** Excalidraw's DOM classes are not public API, so its tool island is
   hidden and `Toolbar.tsx` renders ariadne's floating pill instead. Tools switch through
   `api.setActiveTool`; the active button follows `appState.activeTool`, so Excalidraw's shortcuts stay
   in sync.
4. **Flat element defaults.** New shapes get `roughness: 0`, a solid fill, a 1px stroke, round corners
   and ariadne's text color through `initialData.appState`. The canvas background is ariadne's `--c-bg`.
5. **Sticky notes are composed.** Excalidraw has no such element. A note is a rectangle with a bound,
   centered text, tinted with one of ariadne's node colors, inserted at the viewport center. It is an
   ordinary element and syncs through the Yjs binding unchanged.
6. **Element colors are stored in light-theme space.** Excalidraw's dark theme inverts canvas colors with
   a CSS filter, which turns the same values into dark equivalents.

## Consequences

- The token files are a copy of ariadne's values and must be kept in sync by hand. Sharing them as a
  package is possible later, but ariadne's tokens live in an Angular app today.
- The mapping and the hidden `.shapes-section` rely on Excalidraw internals that can change with an
  upgrade. The frontend spec lists them; the component tests catch a broken toolbar, not a visual
  regression.
- Excalidraw has no public option to replace its color-picker palette, so the picker keeps its default
  swatches. Only the defaults carry the ariadne look, and users can still restyle any element.
- Excalidraw handles keyboard shortcuts only while its own container has focus; the toolbar does not
  change that.
- The custom toolbar has been checked on desktop widths only.
