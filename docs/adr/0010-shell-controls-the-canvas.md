# ADR 0010: The Angular shell owns the top bar and controls the canvas through its element

- Status: accepted
- Date: 2026-10-05
- Issues: #203, #204, #205
- Builds on: [ADR 0004](0004-canvas-library.md), [ADR 0005](0005-canvas-follows-ariadne-design.md), [ADR 0009](0009-angular-shell-state.md)

## Context

The board page is to get a top bar like ariadne's: board identity and sync status on the left, actions
in the middle, theme toggle and Library on the right, replacing Excalidraw's hamburger menu. The canvas
is a React tree inside `<elysion-canvas>` (ADR 0004), the page around it is Angular. Where the bar
lives decides what has to cross that boundary.

Boards live on the server: the list, creating a board, opening one by URL and (later) the user session
are Angular concerns (router, `HttpClient`, auth). What needs the canvas is small: the sync status, the
theme, and later the Library sidebar, export and import.

## Decision

1. **The top bar is an Angular component** in the shell. It sits in the board page next to
   `<elysion-canvas>` and uses the router and the BFF client directly.
2. **The canvas is controlled through its element, in both directions.**
   - _In_, as attributes: `board-id`, `yjs-server-url`, `theme` (existing).
   - _Out_, as events: `ready` and `error` (existing), `status` (`{ status: 'connecting' | 'connected' |
'disconnected' }`, the Yjs connection), `themechange` (`{ theme }`, only when the user switches
     the theme inside the canvas, not when the host sets it).
   - _Commands_, as methods on the element, added when a feature needs one (`toggleLibrary()`,
     `exportBoard(format)`, `importFile(file)` come with their PBIs). Methods rather than attributes,
     because they are actions, not state.
3. **The theme is app-wide state in the shell** (`ThemeService`: a stored explicit choice, otherwise the
   system preference), written to `data-theme` on `<html>` and passed to the canvas as the `theme`
   attribute. A switch inside the canvas arrives as `themechange` and becomes the explicit choice.
4. **The design tokens are one package**, `@elysion/design-tokens`, used by the shell and the canvas
   (and kept in step with ariadne's `styles.scss`), instead of a copy per app.
5. **The canvas fills the space it is given.** Its root is `position: absolute; inset: 0` inside the
   element, which the host sizes; the shell lays out top bar and canvas as a column. The dev entry
   gives `#root` the full viewport itself.

## Consequences

- No board logic in React: the canvas stays reusable and testable without a router or HTTP client.
- Every new canvas capability is a small contract change (an event or a method) that has to be
  documented in the frontend spec and tested on both sides; there is no shared state object.
- Excalidraw's own hamburger menu stays until the top bar covers what it offers (export and import,
  #211); until then the theme can be switched in two places, which `themechange` keeps in step.
- A host that does not size `<elysion-canvas>` gets a canvas that fills its nearest positioned
  ancestor, which is the documented behavior, not an accident.
- The alternative (a bar rendered inside the canvas) would be simpler for Library and export but would
  have to call back into Angular for board navigation and the session.
