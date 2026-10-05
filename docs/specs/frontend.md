# Frontend spec (Angular + React/Excalidraw, TypeScript 6)

## Owner

Frontend

## Responsibilities

Angular shell app embedding a React/Excalidraw canvas component, Yjs client for CRDT sync, WebSocket client for presence, RxJS for state management. See ADR 0002.

## Routes

| URL                            | Result                                                                                                                                                                                                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/board/:boardId`              | The board with that id. The route param is called `boardId` so `withComponentInputBinding()` hands it straight to `Board.boardId`, which becomes the `board-id` attribute of `<elysion-canvas>` and therefore the Yjs room. The id is URL-decoded (`/board/q3%20plan%2Fv2` is the room `q3 plan/v2`). |
| `/board/%20` (whitespace only) | Redirected to the board list by `boardIdGuard`: the id becomes a room name, so an empty one is never connected to.                                                                                                                                                                                    |
| `/`                            | The board list (`BoardList`): the boards from `GET /api/boards`, newest first, each a card linking to its board; see Board list below.                                                                                                                                                                |
| any unknown path               | Redirected to `/`. The room `default` is not a stored board but still opens at `/board/default`.                                                                                                                                                                                                      |

This is what makes collaboration links possible (#101).

### Board list

`BoardList` (`src/app/board-list/`) is the home page, in the look of the top bar on the shared tokens. It loads the boards through `BoardApi.list()` and has three states: **loading** ("Loading boards…"), **error** (a message with "Try again", the BFF being down must not leave a blank page) and **ready**, which is either the grid of board cards (name, creation date; one column per roughly 220 px, so it works at phone width) or the **empty** state with a "Create your first board" button.

**New board** opens an inline form (no browser dialog) with the name preset to "Untitled board", focused and selected; Enter or Create sends `POST /api/boards` (the name is trimmed; blank or longer than 120 characters is refused before the request), Escape or Cancel closes it. While the request runs the form is disabled; if it fails the form stays open with a message so the user can retry. On success the app opens the new board. Until the identity epic lands the list shows every board; with the authorization policies (#117) it shows only the user's boards, without changes here.

The top bar of the board page links back: the brand and an "All boards" button (an icon only below 640 px) both go to `/`.

## Top bar and the element contract

[ADR 0010](../adr/0010-shell-controls-the-canvas.md): the Angular shell owns the top bar (`topbar/top-bar.ts`, after ariadne's `.topbar`: brand, board name, sync status, theme toggle), the canvas stays free of board logic.

| Direction | What                                 | Contract                                                                                                                                                                 |
| --------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| in        | which board                          | attribute `board-id`                                                                                                                                                     |
| in        | gateway                              | attribute `yjs-server-url` (default: same-origin `/yjs`, proxied by `ng serve`, see below)                                                                               |
| in        | theme                                | attribute `theme` (`light` or `dark`)                                                                                                                                    |
| out       | the element started / failed         | events `ready`, `error`                                                                                                                                                  |
| out       | Yjs connection                       | event `status`, `detail: { status: 'connecting' \| 'connected' \| 'disconnected' }`; `connecting` comes first on start                                                   |
| out       | theme switched **inside** the canvas | event `themechange`, `detail: { theme }`; not sent when the host changed the attribute                                                                                   |
| command   | open or close the library sidebar    | method `toggleLibrary()` on the element; a no-op until the canvas is up                                                                                                  |
| out       | library sidebar opened or closed     | event `librarychange`, `detail: { open }`; sent for the host's toggle and for the user's own (Excalidraw's close button)                                                 |
| command   | export the board or the selection    | method `exportBoard(format, { selectionOnly })` resolves with a `Blob` (`png`, `svg` or `excalidraw`), or `null` when there is nothing to export or the canvas is not up |
| command   | replace the board with a file        | method `importFile(file)` resolves with the number of elements in it; rejects when the file is not an Excalidraw file or the canvas is not up                            |
| out       | how many elements are selected       | event `selectioncount`, `detail: { count }` (not `selectionchange`: that is a DOM event for text selection and this one bubbles)                                         |

`Board` (the page) shows the top bar above `<elysion-canvas>`. The title is the board's name when the BFF has one (`BoardApi`, `GET /api/boards/:id`) and the id otherwise: a room such as `default` is not a stored board, so ids that are not UUIDs are not even asked for, and a 404 or a failing BFF falls back to the id. The sync chip shows `Connecting…`, `Connected` or `Offline`.

**Export and import.** The top bar has an Import button and an Export menu (`ExportMenu`, after ariadne's): PNG image, SVG image, Excalidraw file, each for the whole board or, with the 'Selection only' option, for the selected elements and the text inside selected shapes (the option needs `selectioncount > 0`). `Board` calls the element's `exportBoard`, names the file after the board (`exportFilename`: the board's name or id, `-selection` for a selection) and hands the blob to the browser through a temporary link. An empty board or an empty selection is answered with a short message under the bar, nothing is downloaded. Import asks first (an in-page banner, not a browser dialog) and only then calls `importFile`; the result or the reason it failed ("This is not an Excalidraw file.") is shown in the same place.

_Why the import tombstones._ `importFile` does not simply set the scene to the file's elements. The Yjs binding never removes entries from the shared map (deletion is `isDeleted`), so an element that just disappeared from one scene would be merged back from the map and stay on every other peer's board. `replaceScene` therefore marks every live element that is not in the file as deleted, lets the file win for an id that exists in both (with a version above the current one), and adds the new ones. Checked with two tabs on a real realtime service: after an import in one tab the other shows only the imported elements, as does a freshly loaded third.

_Decision: client-side export (#212)._ PNG, SVG and `.excalidraw` are produced in the browser with Excalidraw's own helpers (`exportToBlob`, `exportToSvg`, `serializeAsJSON`); nothing leaves the browser and no service is involved. PDF, which feature #104 also names, is not offered: Excalidraw has no PDF export. The export service (#23) therefore stays unbuilt until PDF or very large or scheduled exports are wanted.

**Main menu.** With theme, export, import and the library in the top bar, Excalidraw's hamburger menu is cut down to what the bar does not offer, using the public `MainMenu` component: Reset the canvas and Help (Excalidraw's own theme shortcut, Alt+Shift+D, stays).

**Library.** The top bar's Library button calls `toggleLibrary()` on the element (`Board` finds it with `viewChild` and the `CanvasElement` type) and shows `aria-pressed` from `librarychange`. Inside, `CanvasApp` hands the host a small controls object once (`onControls`, which the element turns into its methods; later commands such as export join it) and reports `appState.openSidebar` for the default sidebar. Excalidraw's own floating Library button is not hidden with CSS on an internal class: `CanvasApp` renders its own `<DefaultSidebar.Trigger style="display: none">`, which takes the place of Excalidraw's fallback trigger (a test fails if that stops working after an upgrade). The sidebar itself is Excalidraw's, with its search and library tabs, its dock and close buttons.

**Theme.** `ThemeService` is app-wide: an explicit choice (top bar, or Excalidraw's own toggle, which arrives as `themechange`) is remembered in `localStorage` (`elysion.theme`, tolerant of blocked storage); without one the system preference is followed live. It sets `data-theme` on `<html>` for the tokens and the canvas `theme` attribute. The theme is switched in the top bar or with Excalidraw's own shortcut (Alt+Shift+D); `themechange` keeps the shell in step with the second. `CanvasApp` recognizes a switch by the user from a change of Excalidraw's own `appState.theme` between two `onChange` calls, not from a difference to its own state: after the host changes the attribute, Excalidraw's value lags behind for a moment, and treating that as a user switch made the two flip each other.

**Layout.** The canvas root is `position: absolute; inset: 0` and fills the element it is in; the element needs a size of its own. `Board` is a flex column (top bar, then `<elysion-canvas>` with `flex: 1`); the standalone dev entry gives `#root` the viewport. Excalidraw's own UI (hamburger, Library) therefore sits below the bar.

**Dev proxy.** `apps/frontend/proxy.conf.json` (wired in angular.json) forwards `/api` to the BFF (3000) and `/yjs` (WebSocket) to realtime (3001), so the Angular app talks to both through its own origin as it will behind Traefik, and two tabs on one board URL sync without extra parameters. It is read when `ng serve` starts.

## Canvas embedding

The React/Excalidraw canvas lives in its own workspace package, `apps/frontend-canvas`, and is embedded via a **custom element** (`<elysion-canvas>`), not Angular Elements:

- `apps/frontend-canvas` builds two ways from the same `CanvasApp` React root: a standalone Vite dev app (for iterating on the canvas in isolation) and a library-mode bundle (`build:element`) that registers `<elysion-canvas>` as a custom element, bundling its own React/ReactDOM runtime and CSS so the host page needs nothing extra.
- `apps/frontend`'s `Board` component (`board/`) loads that bundle at runtime via a `<script>` tag (`CanvasElementLoader`, pointed at `CANVAS_ELEMENT_SRC`, default `/canvas/elysion-canvas.js`) and renders `<elysion-canvas>` in its template, with `CUSTOM_ELEMENTS_SCHEMA` so Angular's compiler allows the unknown tag.
- The Angular↔React contract is a `board-id` attribute in, and `ready`/`error` custom events out (surfaced as a `Board.status` signal) — kept minimal on purpose so the Yjs and presence features have a place to attach later.
- Build integration: `apps/frontend`'s `prebuild` npm script builds the element bundle and copies the whole `dist-element/` directory into `public/canvas/`, so `pnpm --filter @elysion/frontend build` (and the Dockerfile, which now also installs `apps/frontend-canvas`) produce a single deployable artifact with the canvas bundle already in place — no manual copy step. The element bundle is built as an **ES module**, not iife: Excalidraw's optional heavy features (mermaid/cytoscape/katex diagram import, image resizing) need to stay as separate lazy chunks loaded only on demand, which iife's single-file output can't do — that's why the copy step grabs the whole directory rather than one file.

This was chosen over Angular Elements (which wraps an _Angular_ component as a custom element) because the piece being embedded is a React tree; a plain custom element wrapping a React root needs no Angular-specific tooling and keeps the two frameworks' build pipelines fully independent.

## Theming (ariadne design)

The canvas UI follows the design of GravionLabs/ariadne:

- `packages/design-tokens/tokens.css` (`@elysion/design-tokens`) holds ariadne's `--c-*` design tokens (light and dark). The Angular shell loads it on `<html>` (angular.json `styles`), the canvas bundle imports it and applies it to its own `.elysion-canvas` root as well, so the bundle works without the host's copy and nothing leaks into the host page. Keep the names and values in sync with ariadne's `apps/web/src/styles.scss`.
- `styles/excalidraw-theme.css` maps those tokens onto Excalidraw's own CSS custom properties (`--island-bg-color`, `--color-primary*`, `--color-surface-*`, `--shadow-island`, radii, ...). Scoping under `.elysion-canvas` beats Excalidraw's `.excalidraw` / `.excalidraw.theme--dark` rules by specificity, independent of stylesheet order. Excalidraw's DOM classes are not public API, so only its documented-by-use variables are overridden; hardcoded spots would need targeted selectors and are an upgrade risk.
- The `theme` attribute on `<elysion-canvas>` (`light` | `dark`, also an input on Angular's `Board`) sets `data-theme` on the root and Excalidraw's `theme` prop. Without it the canvas follows `prefers-color-scheme` live. Because a `theme` is always passed to Excalidraw, its own light/dark toggle (main menu, Alt+Shift+D) is enabled explicitly with `UIOptions.canvasActions.toggleTheme` (Excalidraw otherwise shows it only when no `theme` is given, #197); `CanvasApp` keeps the active theme from `appState.theme`, so the tokens and the minimap follow a toggle, and a changed attribute or system preference still wins over it.

## Bottom toolbar

Excalidraw's own top tool island is hidden (`.shapes-section`, in `styles/toolbar.css`) and replaced by `Toolbar.tsx`, a bottom-centered floating pill styled after ariadne's toolbox (surface background, 1px border, `--radius-xl`, `--shadow-md`, 34px icon buttons, dividers between groups, `--c-primary-soft` for the active tool, wrapping on narrow viewports). Excalidraw's DOM classes are not public API, so the island is hidden rather than restyled; its keyboard shortcuts keep working.

- Clicking a button calls `excalidrawAPI.setActiveTool({ type })`.
- The active button is derived from `appState.activeTool.type` in `onChange`, so shortcuts and any other tool change stay in sync.
- The pill is a `role="toolbar"` with `aria-label`, `aria-pressed` and `title="<name> (<shortcut>)"` per button and a `:focus-visible` outline.
- Excalidraw handles shortcuts only while its own container has focus (`handleKeyboardGlobally` is off); the toolbar does not change that.

## Minimap

`Minimap.tsx` is an overview of the whole scene at the bottom left, modeled on ariadne's (`.minimap` in `editor.scss`): 160x120, `--c-surface-1`, 1px `--c-border`, `--radius-md`, `--shadow`. Elements are drawn as grey rectangles, the visible area as a `--c-primary` frame. Excalidraw has no minimap (ariadne's comes from f-flow), so it is built here.

- `CanvasApp` copies the live elements and the scroll, zoom and canvas size from `onChange` into a `SceneStore`, which lives outside React state: a drag on the canvas then re-renders only the minimap, not `CanvasApp` and Excalidraw. Redraws are throttled to one per animation frame.
- `minimap-geometry.ts` holds the maths, unit-tested without a DOM: scene bounds (elements plus viewport, so the frame never leaves the minimap, and at least two viewports wide and high, like ariadne's `fMinSize`, so the frame stays at most about half the minimap instead of filling it when the content is small), the scale, and the mapping back to scene points. Bounds use a loop, because spreading hundreds of thousands of elements into `Math.min` overflows the call stack. Layout plus mapping took 4 ms for 5,000 and 9 ms for 50,000 elements.
- Clicking or dragging in it pans the canvas: the picked scene point is scrolled to the center through `updateScene({ appState: { scrollX, scrollY } })`. Scroll is local state and is not written to Yjs. While dragging, the mapping (scale and origin) is frozen, because it includes the viewport and would otherwise rescale under the pointer, but the frame keeps following the view (`followViewport`); the elements therefore stay where they are until release; the pointer is clamped to the minimap, so dragging out stops at its edge instead of flying the view away from the content. On release the layout is unfrozen and the minimap re-fits to the current scene (it must redraw then even if no scene change follows, #190).
- It is hidden while the scene is empty. It sits above Excalidraw's zoom and undo controls (`--elysion-minimap-bottom`, 72px) and below Excalidraw's UI layer, so the property panel is never covered; once those controls move into the toolbar (#181) the bottom is 16px like ariadne's.
- jsdom does not fire Excalidraw's `onChange` after `updateScene`, so the wiring into `CanvasApp` is checked in the browser, not in a unit test.

## Canvas element style

Excalidraw draws elements with roughjs onto a `<canvas>`, so their look is element properties, not CSS (unlike the UI chrome above):

- `element-style.ts` sets defaults for newly drawn shapes through `initialData.appState`: `roughness: 0` (flat instead of hand-drawn), solid fill, 1px stroke, round corners, ariadne's text color and Helvetica. The canvas background is ariadne's `--c-bg`. Users can still change any element's style in Excalidraw's property panel; the defaults only make the ariadne look the path of least resistance. Excalidraw has no public prop to replace its color-picker palette, so the picker keeps its default swatches.
- **Sticky notes** are not a native Excalidraw element. `sticky-note.ts` builds one as a rectangle with a bound, centered text (via `convertToExcalidrawElements`) in the look of ariadne's node cards: the accent color as 1px border and a 14% tint of it as fill. The toolbar's sticky button opens a row of ariadne's `--c-node-*` colors and inserts the note at the viewport center, selected (press Enter to edit its text). Being ordinary elements, notes sync through the Yjs binding unchanged.
- Colors are stored in light-theme space. Excalidraw's dark theme inverts canvas colors with a CSS filter (`invert(93%) hue-rotate(180deg)`), which turns the same values into dark equivalents; the accent hues survive the hue rotation.

## Small screens

Excalidraw switches to a compact layout on its own, for a phone or a short landscape window, and offers no option to turn that off. There it renders a mobile toolbar of its own on top, a loose hand tool beside it and its menu in a bar along the bottom edge. For the canvas this means:

- Excalidraw's mobile toolbar island (`.App-toolbar--mobile`) and its loose tools (`.mobile-misc-tools-container`) are hidden like `.shapes-section` on desktop; our toolbar is the only tool bar (bug #176). Like the desktop one, these are internal classes and an upgrade risk.
- The toolbar takes `width: max-content` instead of the half of the width that `left: 50%` leaves, so a phone gets two rows, not four.
- The compact layout is recognized by Excalidraw's own container for it (`:has(.mobile-misc-tools-container)`), not by guessed thresholds. Then the toolbar sits 72px above the bottom edge so it does not cover Excalidraw's menu bar, and the minimap is left out (it would sit on the toolbar).

Checked in a browser at 390x740 (phone), 800x480 (short landscape) and 1100x700 (desktop): no Excalidraw tool icons, no overlap between toolbar, minimap, menu and footer. CSS is not exercised by the unit tests (jsdom has no layout), so a regression here shows up in a browser, not in `pnpm test`.

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
