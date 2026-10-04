# ADR 0004: Excalidraw as the canvas library, embedded as a custom element

- Status: accepted
- Date: 2026-10-04
- Issues: #25, #68, #123, #124, #126, #127, #128
- Builds on: [ADR 0002](0002-typescript-version-split.md)

## Context

Elysion is a collaborative whiteboard: freehand drawing, shapes, text, images, sticky notes, an infinite
canvas and live cursors. The shell around it is Angular. Three options were on the table over time:

- **tldraw** was the first canvas (#25). Its SDK is source-available, not open source: the license
  forbids a production environment without a paid or non-commercial key and shows a watermark. That
  does not fit a genuinely open-source Mural alternative.
- **Foblex f-flow** (`@foblex/flow`) is what GravionLabs/ariadne uses. It is Angular-native and MIT, but it
  is a node-and-edge flow editor with auto-layout, not a whiteboard: no freehand drawing, no free
  shapes, text or images, no whiteboard selection model. Everything Elysion needs would have to be
  built on top of it (#123, #124).
- **Excalidraw** (`@excalidraw/excalidraw`, MIT) has the whiteboard primitives, a public imperative API
  and an element model that is easy to bind to a CRDT. It is a React component.

## Decision

1. **The canvas is Excalidraw.** tldraw was replaced under #68; f-flow was evaluated and rejected for
   this purpose. That evaluation was a desk comparison against ariadne's use and f-flow's documented
   scope, not a prototype. f-flow only becomes interesting if Elysion ever adds a structured-diagram mode next to
   the whiteboard.
2. **It lives in its own workspace package**, `apps/frontend-canvas`, and is embedded in Angular as a
   plain **custom element** (`<elysion-canvas>`), not through Angular Elements. The contract is small:
   `board-id`, `yjs-server-url` and `theme` attributes in, `ready` and `error` events out.
3. **The element bundle is an ES module**, not an IIFE, so Excalidraw's heavy optional features
   (diagram import, image resizing) stay separate lazy chunks. The Angular build copies the whole
   `dist-element/` directory into `public/canvas/`.
4. **Collaboration uses Yjs** with a binding written for Excalidraw's element array
   (`yjs/excalidraw-binding.ts`) and a client for the realtime gateway's sync protocol.

## Comparison with Foblex f-flow

Checked against `@foblex/flow` 19.3.0 as installed in ariadne (MIT, Angular-native), by reading its
package: the exported building blocks are a canvas with zoom and pan, nodes, connectors and connections,
groups, a minimap, a selection area, resize handles, snapping and magnetic lines, auto-pan and a
history for undo. Nothing
in it deals with freehand strokes, free shapes, text, images or notes; searching the package for
freehand or whiteboard features finds nothing. It was not prototyped.

| Need of a whiteboard                          | Excalidraw                 | f-flow                                |
| --------------------------------------------- | -------------------------- | ------------------------------------- |
| Freehand drawing, eraser                      | built in                   | not provided                          |
| Rectangles, ellipses, diamonds, arrows, lines | built in elements          | nodes you build yourself, edges only  |
| Free text and images                          | built in                   | not provided                          |
| Infinite canvas, pan, zoom, selection, undo   | built in                   | canvas, zoom, selection area, history |
| Structured nodes with ports and auto-layout   | not its model              | its core strength                     |
| Public API to drive it from outside           | imperative API, `onChange` | Angular directives and events         |
| Framework                                     | React                      | Angular                               |
| License                                       | MIT                        | MIT                                   |

Both are MIT, so the license does not decide anything here (it did for tldraw). What decides is the
model: f-flow is for graphs of boxes and arrows, Elysion is for free-form boards.

## What replacing the canvas would cost

Measured on `main` at the time of writing. Only the Excalidraw-specific code would go; the transport and
the host contract would stay.

- **Would be rewritten:** the Yjs binding (`yjs/excalidraw-binding.ts`, 72 lines, which maps Excalidraw's
  element array onto a `Y.Map`), `CanvasApp.tsx` (112), the toolbar (`Toolbar.tsx`, 246), sticky notes
  (63), element defaults (20) and the mapping of tokens onto Excalidraw's variables.
- **Would stay:** the WebSocket transport (`YjsWebsocketClient.ts`, 138 lines, which only speaks the
  gateway's sync protocol), the design tokens, and the Angular host (`Board` and the element loader,
  72 lines), which only knows the element's attributes and events.
- **The real cost is not those lines.** It is the whiteboard feature set f-flow lacks (drawing, free
  shapes, text, images, eraser, notes), which would have to be built first, together with the
  bug classes the current binding already ran into (late joiners, in-place edits aliasing the shared
  map, see the frontend spec). About 500 lines of canvas tests would be rewritten with it.
- **What it would buy:** no second framework, no React bridge, one build pipeline. Elysion does not
  need a structured-diagram editor today, so that benefit does not outweigh the cost.

## Consequences

- Two UI frameworks, two build pipelines. The React tree is isolated behind the element contract, so the
  Angular side needs no React knowledge, but each host input has to be added to the element by hand.
- Elysion owns the Yjs binding. Excalidraw mutates its elements in place, so the binding clones on write
  and merges remote changes with Excalidraw's own reconcile; the details are in the frontend spec.
- Excalidraw's element model decides what a "sticky note" or a frame can be. Features are built from
  its elements, not from custom node types.
- Whether the Angular shell adopts NgRx SignalStore is a separate question (#125) and not decided here.
