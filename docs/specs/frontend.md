# Frontend spec (Angular + React/Excalidraw, TypeScript 6)

## Owner
Frontend

## Responsibilities
Angular shell app embedding a React/Excalidraw canvas component, Yjs client for CRDT sync, WebSocket client for presence, RxJS for state management. See ADR 0002.

## Canvas embedding

The React/Excalidraw canvas lives in its own workspace package, `apps/frontend-canvas`, and is embedded via a **custom element** (`<elysion-canvas>`), not Angular Elements:

- `apps/frontend-canvas` builds two ways from the same `CanvasApp` React root: a standalone Vite dev app (for iterating on the canvas in isolation) and a library-mode bundle (`build:element`) that registers `<elysion-canvas>` as a custom element, bundling its own React/ReactDOM runtime and CSS so the host page needs nothing extra.
- `apps/frontend`'s `Board` component (`board/`) loads that bundle at runtime via a `<script>` tag (`CanvasElementLoader`, pointed at `CANVAS_ELEMENT_SRC`, default `/canvas/elysion-canvas.js`) and renders `<elysion-canvas>` in its template, with `CUSTOM_ELEMENTS_SCHEMA` so Angular's compiler allows the unknown tag.
- The Angular↔React contract is a `board-id` attribute in, and `ready`/`error` custom events out (surfaced as a `Board.status` signal) — kept minimal on purpose so the Yjs and presence features have a place to attach later.
- Build integration: `apps/frontend`'s `prebuild` npm script builds the element bundle and copies the whole `dist-element/` directory into `public/canvas/`, so `pnpm --filter @elysion/frontend build` (and the Dockerfile, which now also installs `apps/frontend-canvas`) produce a single deployable artifact with the canvas bundle already in place — no manual copy step. The element bundle is built as an **ES module**, not iife: Excalidraw's optional heavy features (mermaid/cytoscape/katex diagram import, image resizing) need to stay as separate lazy chunks loaded only on demand, which iife's single-file output can't do — that's why the copy step grabs the whole directory rather than one file.

This was chosen over Angular Elements (which wraps an *Angular* component as a custom element) because the piece being embedded is a React tree; a plain custom element wrapping a React root needs no Angular-specific tooling and keeps the two frameworks' build pipelines fully independent.

## Why Excalidraw, not tldraw

The canvas was originally built on tldraw (see GitHub Feature #25), but tldraw's SDK is source-available, not open source: its license prohibits use in a "Production Environment" without a paid or non-commercial License Key, and enforces this with a "Get a license for production" watermark. Elysion is meant to be a genuinely open-source Mural alternative, so the canvas was swapped to [Excalidraw](https://github.com/excalidraw/excalidraw) (`@excalidraw/excalidraw`), which is MIT-licensed (see GitHub Feature #68). The embedding architecture above is unaffected by that swap — it only changed what renders inside `CanvasApp`.

Note: Excalidraw has no built-in local-persistence equivalent to tldraw's `persistenceKey`; `CanvasApp`'s `boardId` prop is currently unused internally and is kept only for the Angular↔React contract, pending the Yjs-backed persistence work in Feature #26.
