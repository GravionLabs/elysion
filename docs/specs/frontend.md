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

This was chosen over Angular Elements (which wraps an _Angular_ component as a custom element) because the piece being embedded is a React tree; a plain custom element wrapping a React root needs no Angular-specific tooling and keeps the two frameworks' build pipelines fully independent.

## Theming (ariadne design)

The canvas UI follows the design of GravionLabs/ariadne:

- `apps/frontend-canvas/src/styles/tokens.css` holds ariadne's `--c-*` design tokens (light and dark), scoped to the `.elysion-canvas` root that `CanvasApp` renders, so nothing leaks into the host page. Keep the names and values in sync with ariadne's `apps/web/src/styles.scss`.
- `styles/excalidraw-theme.css` maps those tokens onto Excalidraw's own CSS custom properties (`--island-bg-color`, `--color-primary*`, `--color-surface-*`, `--shadow-island`, radii, ...). Scoping under `.elysion-canvas` beats Excalidraw's `.excalidraw` / `.excalidraw.theme--dark` rules by specificity, independent of stylesheet order. Excalidraw's DOM classes are not public API, so only its documented-by-use variables are overridden; hardcoded spots would need targeted selectors and are an upgrade risk.
- The `theme` attribute on `<elysion-canvas>` (`light` | `dark`, also an input on Angular's `Board`) sets `data-theme` on the root and Excalidraw's `theme` prop. Without it the canvas follows `prefers-color-scheme` live.

## Bottom toolbar

Excalidraw's own top tool island is hidden (`.shapes-section`, in `styles/toolbar.css`) and replaced by `Toolbar.tsx`, a bottom-centered floating pill styled after ariadne's toolbox (surface background, 1px border, `--radius-xl`, `--shadow-md`, 34px icon buttons, dividers between groups, `--c-primary-soft` for the active tool, wrapping on narrow viewports). Excalidraw's DOM classes are not public API, so the island is hidden rather than restyled; its keyboard shortcuts keep working.

- Clicking a button calls `excalidrawAPI.setActiveTool({ type })`.
- The active button is derived from `appState.activeTool.type` in `onChange`, so shortcuts and any other tool change stay in sync.
- The pill is a `role="toolbar"` with `aria-label`, `aria-pressed` and `title="<name> (<shortcut>)"` per button and a `:focus-visible` outline.
- Excalidraw handles shortcuts only while its own container has focus (`handleKeyboardGlobally` is off); the toolbar does not change that.

## Canvas element style

Excalidraw draws elements with roughjs onto a `<canvas>`, so their look is element properties, not CSS (unlike the UI chrome above):

- `element-style.ts` sets defaults for newly drawn shapes through `initialData.appState`: `roughness: 0` (flat instead of hand-drawn), solid fill, 1px stroke, round corners, ariadne's text color and Helvetica. The canvas background is ariadne's `--c-bg`. Users can still change any element's style in Excalidraw's property panel; the defaults only make the ariadne look the path of least resistance. Excalidraw has no public prop to replace its color-picker palette, so the picker keeps its default swatches.
- **Sticky notes** are not a native Excalidraw element. `sticky-note.ts` builds one as a rectangle with a bound, centered text (via `convertToExcalidrawElements`) in the look of ariadne's node cards: the accent color as 1px border and a 14% tint of it as fill. The toolbar's sticky button opens a row of ariadne's `--c-node-*` colors and inserts the note at the viewport center, selected (press Enter to edit its text). Being ordinary elements, notes sync through the Yjs binding unchanged.
- Colors are stored in light-theme space. Excalidraw's dark theme inverts canvas colors with a CSS filter (`invert(93%) hue-rotate(180deg)`), which turns the same values into dark equivalents; the accent hues survive the hue rotation.

## Why Excalidraw, not tldraw

The decision, the comparison with Foblex f-flow and the cost of replacing the canvas are recorded in [ADR 0004](../adr/0004-canvas-library.md).

The canvas was originally built on tldraw (see GitHub Feature #25), but tldraw's SDK is source-available, not open source: its license prohibits use in a "Production Environment" without a paid or non-commercial License Key, and enforces this with a "Get a license for production" watermark. Elysion is meant to be a genuinely open-source Mural alternative, so the canvas was swapped to [Excalidraw](https://github.com/excalidraw/excalidraw) (`@excalidraw/excalidraw`), which is MIT-licensed (see GitHub Feature #68). The embedding architecture above is unaffected by that swap — it only changed what renders inside `CanvasApp`.

## Yjs client integration

`apps/frontend-canvas` connects the Excalidraw scene to `apps/realtime`'s Yjs sync gateway (Feature #16):

- `yjs/YjsWebsocketClient.ts` speaks the same sync sub-protocol as the gateway over a plain WebSocket — not `y-websocket`'s `WebsocketProvider`, whose room-in-path URL convention the gateway can't route (see the gateway's own doc comment for why). On open, it sends its own sync-step-1 in addition to replying to the server's — without that, a client joining a board with existing history never asks for it and stays empty.
- `yjs/excalidraw-binding.ts`'s `ExcalidrawYjsBinding` keeps a `Y.Map<elementId, element>` in sync with the scene: local `onChange` writes changed elements in (compared by `version`, cloned via `structuredClone` before storing — Excalidraw mutates its element objects in place, so storing the live reference would alias `Y.Map.get()`'s result with the object Excalidraw keeps mutating, permanently freezing the version comparison after the first write), and remote map changes are merged back via Excalidraw's own `reconcileElements` + `updateScene(captureUpdate: NEVER)`.
- The same aliasing existed in the other direction and was found by the two-tab check (#173): `reconcileElements` returns the objects stored in the `Y.Map` themselves, so Excalidraw's in-place edits (a move) landed in the map behind Yjs's back and were never written. This hit the writer too, since map observers also fire for local writes. `#handleRemoteChange` therefore hands the scene clones of every stored object; the two-peer test moves an already-synced element back and forth to cover it.
- `CanvasApp` wires a `Y.Doc` + client + binding together in a `useEffect` (not render-body lazy-init): React StrictMode's dev-only mount→cleanup→mount for effects means a "create once in render, null out in cleanup" pattern leaves the binding permanently `null` after the simulated cleanup, since nothing re-populates it without a following render.
- The Yjs server URL is a `yjsServerUrl` prop on `CanvasApp`, threaded out as the `yjs-server-url` attribute on `<elysion-canvas>` (mirroring `board-id`) and a matching Angular input on `Board`; defaults to a same-origin `/yjs` path when unset (production routing through Traefik isn't settled yet — Feature #28).

Presence/cursors (Feature #27) and WS auth (Feature #18) aren't wired in on the frontend yet — the realtime backend now broadcasts awareness cross-instance via Redis (see docs/specs/realtime.md), waiting on a frontend client to actually send/render it.
