# apps/frontend-canvas — Agent Instructions

React + tldraw canvas, TypeScript 6. Ships two ways from the same source:

- as a standalone Vite dev app (`src/main.tsx`) for iterating on the canvas in isolation
- as an embeddable custom element bundle (`src/element.tsx`, `<elysion-canvas>`) consumed by `apps/frontend` (Angular)

See `docs/specs/frontend.md` and the parent issue tracking this: GitHub Feature #25.

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

## Verifying changes

`pnpm --filter @elysion/frontend-canvas test` must pass, then `pnpm --filter @elysion/frontend-canvas build` and `build:element` must both succeed.
