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
pnpm --filter @elysion/frontend-canvas test               # vitest
```

## Conventions

- Package name is `@elysion/frontend-canvas` — the workspace filter and any future Docker/build wiring depend on this.
- TypeScript stays on 6.x, matching `apps/frontend` — see the root `AGENTS.md`.
- `CanvasApp` is the shared React root; `main.tsx` mounts it directly for dev, `element.tsx` mounts it inside a custom element for embedding. Keep canvas logic in `CanvasApp` (or components it owns), not duplicated across the two entry points.
- The custom element bundle bundles its own React/ReactDOM runtime so the Angular host doesn't need to provide one.
- `yjs/` wires the scene to `apps/realtime`'s sync gateway — see `docs/specs/frontend.md`'s "Yjs client integration" section before touching it; the two bugs fixed there (initial-sync-to-late-joiner, in-place-mutation aliasing) are exactly the kind that pass unit tests against fresh/empty rooms but break in a real two-tab session, so verify any change against a real running `apps/realtime` and two browser tabs, not just `vitest`.

## Look and feel

The canvas follows ariadne's design: `src/styles/` (tokens, Excalidraw variable mapping, toolbar), `Toolbar.tsx`, `element-style.ts`, `sticky-note.ts` — see "Theming", "Bottom toolbar" and "Canvas element style" in `docs/specs/frontend.md`. The dev entry accepts `?theme=light|dark` for checking both themes.

## Verifying changes

`pnpm --filter @elysion/frontend-canvas test` must pass, then `pnpm --filter @elysion/frontend-canvas build` and `build:element` must both succeed. For anything touching `yjs/`, also manually verify: run `apps/realtime` for real (`node dist/main.js`), point two browser tabs at the dev entry with the same board and the gateway, e.g. `http://localhost:5199/?board=my-board&yjs=ws://localhost:3001/yjs` (run realtime with `PORT=3001`; the dev entry also takes `?theme=light|dark`), and confirm an edit in one appears in the other — including _moving_ an element that already synced, in both directions — unit tests alone missed both real bugs found here because they used fresh/empty rooms, not a room with pre-existing history from a late-joining peer.
