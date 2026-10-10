# apps/frontend-canvas — Agent Instructions

React + Excalidraw canvas, TypeScript 6. Ships two ways from the same source:

- as a standalone Vite dev app (`src/main.tsx`) for iterating on the canvas in isolation
- as an embeddable custom element bundle (`src/element.tsx`, `<elysion-canvas>`) consumed by `apps/frontend` (Angular)

See `docs/specs/frontend.md` and the parent issue tracking this: GitHub Feature #68 (originally built on tldraw under #25 — see the spec's "Why Excalidraw, not tldraw" section).

The element bundle builds as an **ES module** (not iife) so Excalidraw's optional heavy features (mermaid/cytoscape/katex diagram import, image resizing) stay as separate lazy chunks — `dist-element/` therefore has many files, not just `elysion-canvas.js`; copy the whole directory, not one file.

## Commands

```sh
pnpm --filter @elysion/frontend-canvas dev              # standalone dev server
pnpm --filter @elysion/frontend-canvas build             # typecheck + app build
pnpm --filter @elysion/frontend-canvas build:element      # typecheck + custom-element bundle (dist-element/)
pnpm --filter @elysion/frontend-canvas build:element:watch # rebuild on change and refresh apps/frontend/public/canvas
pnpm --filter @elysion/frontend-canvas test               # vitest
```

## Conventions

- Package name is `@elysion/frontend-canvas` — the workspace filter and any future Docker/build wiring depend on this.
- TypeScript stays on 6.x, matching `apps/frontend` — see the root `AGENTS.md`.
- `CanvasApp` is the shared React root; `main.tsx` mounts it directly for dev, `element.tsx` mounts it inside a custom element for embedding. Keep canvas logic in `CanvasApp` (or components it owns), not duplicated across the two entry points.
- The custom element bundle bundles its own React/ReactDOM runtime so the Angular host doesn't need to provide one.
- `yjs/` wires the scene to `apps/realtime`'s sync gateway — see `docs/specs/frontend.md`'s "Yjs client integration" section before touching it; the two bugs fixed there (initial-sync-to-late-joiner, in-place-mutation aliasing) are exactly the kind that pass unit tests against fresh/empty rooms but break in a real two-tab session, so verify any change against a real running `apps/realtime` and two browser tabs, not just `vitest`.

## The grid

The dot grid is CSS behind a **transparent** static canvas (`grid-dots.ts`, `styles/grid.css`), and Excalidraw's own line grid is switched off by `vite-plugin-excalidraw-no-grid.ts`; snapping is Excalidraw's grid mode, set from the setting. The settings (show, snap, size) are the board's, in the document's `meta.grid` (`board-settings.ts`), on by default. If an Excalidraw update fails the build with "the call renderGrid ... is gone", read "The grid" in `docs/specs/frontend.md` before touching the plugin.

## Look and feel

The canvas follows ariadne's design: the tokens come from `packages/design-tokens` (shared with the Angular shell), `src/styles/` has the Excalidraw variable mapping and the toolbar, `Toolbar.tsx`, `element-style.ts`, `sticky-note.ts` — see "Theming", "Bottom toolbar" and "Canvas element style" in `docs/specs/frontend.md`. The dev entry accepts `?theme=light|dark` for checking both themes.

## The library

The user's Excalidraw library lives in local storage (`library-store.ts`) and `CanvasApp` adds the library the library site sends back in `#addLibrary=…` (allowed hosts only, the same two the CSP opens); not `useHandleLibrary`, see "The library" in `docs/specs/frontend.md`. A change to the allowed hosts is a change to `apps/frontend/security-headers.sh` too. `apps/e2e/tests/library.spec.ts` stubs the library site.

## Localization

The attribute `locale` (`en` default, `de`; unknown is `en`) reaches `CanvasApp` as `locale`; `src/i18n.tsx` has the typed dictionaries (`de` must have exactly the keys of `en`) and the `useI18n()` hook, and Excalidraw gets `langCode`. Every new user-visible string (label, title, aria-label, placeholder, hint, error the canvas raises) goes into both dictionaries, not inline; see "Localization" in `docs/specs/frontend.md`.

## Element contract

Attributes in (`board-id`, `yjs-server-url`, `theme`, `locale`, `user-name`, `user-id`, `user-color`), events out (`ready`, `fileerror` (an image could not be stored or loaded, with a `message`), `error` (connection failures, with a `message`), `status`, `themechange`, `librarychange`, `selectioncount`, `presence` (the other people on the board, debounced; the pointers never leave the canvas), `timer` (the board's shared timer, ADR 0020: its state or `null`), `voting` (the dot voting: the caller's own view of the current session or `null`)), methods `startTimer`, `pauseTimer`, `resumeTimer`, `extendTimer`, `stopTimer`, `startVoting`, `endVoting`, `clearVotingResults`, `scrollToElement` (the timer and the voting live in the document's map `session`, `src/facilitation/`; the voting is nested Yjs types, see `voting.ts`), methods (`toggleLibrary()`, `exportBoard()`, `importFile()`), a boolean attribute `readonly` (a viewer: Excalidraw's `viewModeEnabled`, a toolbar with only the zoom, `importFile()` rejects), and the **properties** `tokenProvider` and `fileStore` the host sets (`fileStore` is `{ put(file, id), get(id) }`: where the bytes of the board's images live; the binding uploads a new image through it and puts only `{ mimeType, created }` into the document's `files` map, and loads the images of the others with `get`; a refused or failed one takes the element off the board and is announced as `fileerror`, see "Board files" in `docs/specs/frontend.md`) (an async function the canvas calls before every connection for the WS token on the `/yjs` URL: a token, or `null` for "do not connect"; a rejection is retried with backoff; `YjsWebsocketClient` option of the same name). The standalone dev entry takes `?token=`. `board-io.ts` holds export and import (`exportBoard(format)` with `png`, `svg`, `pdf` or `excalidraw`; the PDF is made in `pdf.ts` from the SVG export with jsPDF and svg2pdf.js, loaded on demand, see ADR 0013; specs of it stub `getBBox` for jsdom); an import replaces the scene with tombstones for the old elements (see the spec), never by just dropping them: see "Top bar and the element contract" in `docs/specs/frontend.md` and ADR 0010. A new capability the shell needs is a new event or method there, with a test on both sides. The root fills the element it is in (`position: absolute; inset: 0`), so the host must size `<elysion-canvas>`.

## Flaky tests

A test that passes alone and fails in `pnpm test` is a timing problem under load, not a retry: `test-setup.ts` sets Testing Library's `asyncUtilTimeout` to 5 s (its 1 s default is too short while every app's suite runs at once) and `vite.config.ts` the test timeout to 30 s (the first test of a file that mounts Excalidraw is slow). To check a test after a change, run it in a loop with the CPU busy, e.g. eight `while :; do :; done` loops in the background and `pnpm exec vitest run src/QuickConnect.spec.tsx` fifty times; `QuickConnect.spec.tsx` passed 50 of 50 that way (#719).

## Verifying changes

`pnpm --filter @elysion/frontend-canvas test` must pass, then `pnpm --filter @elysion/frontend-canvas build` and `build:element` must both succeed. For anything touching `yjs/`, also manually verify: run `apps/realtime` for real (`node dist/main.js`), point two browser tabs at the dev entry with the same board and the gateway, e.g. `http://localhost:5199/?board=my-board&yjs=ws://localhost:3001/yjs` (run realtime with `PORT=3001`; the dev entry also takes `?theme=light|dark`), and confirm an edit in one appears in the other — including _moving_ an element that already synced, in both directions — unit tests alone missed both real bugs found here because they used fresh/empty rooms, not a room with pre-existing history from a late-joining peer.
