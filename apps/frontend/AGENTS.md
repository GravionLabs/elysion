# apps/frontend — Agent Instructions

Angular 22 app, TypeScript 6. Embeds a React/Excalidraw canvas via a custom element (see `board/`); a Yjs client is not yet wired in. The shell (`App` component, header + `router-outlet`) has a single route rendering `Board` (`src/app/board/`).

See `docs/specs/frontend.md` and `docs/adr/0002-typescript-version-split.md`.

## Commands

```sh
pnpm --filter @elysion/frontend start   # dev server
pnpm --filter @elysion/frontend build   # builds the canvas element bundle first, then ng build — see below
pnpm --filter @elysion/frontend exec ng test --watch=false
```

## Conventions

- Standalone components only (no NgModules) — this is the Angular CLI default for new components; keep it that way.
- Package name is `@elysion/frontend`, not `frontend` — the workspace filter and Dockerfile depend on this.
- TypeScript stays on 6.x — see the root `AGENTS.md` and `docs/adr/0002-typescript-version-split.md` before bumping.
- Don't add SSR — this app is scaffolded with `--ssr=false` and the Dockerfile serves a static build through nginx (`nginx.conf` has the SPA `try_files` fallback).
- The `<elysion-canvas>` custom element (from `apps/frontend-canvas`) is loaded at runtime via a `<script>` tag pointed at `/canvas/elysion-canvas.js` (see `board/canvas-element-loader.ts`), not bundled into the Angular build — that file is produced by `apps/frontend-canvas`'s `build:element` script and copied into `public/canvas/` by this package's `prebuild` script (npm lifecycle hook, runs automatically before `pnpm --filter @elysion/frontend build`; does **not** run if you invoke `ng build` directly via `exec`).

## Docker

Build from the repo root: `docker build -f apps/frontend/Dockerfile -t elysion-frontend .` — the build stage copies both `apps/frontend` and `apps/frontend-canvas`, runs `pnpm install --filter @elysion/frontend... --filter @elysion/frontend-canvas...` against the workspace root, then `pnpm --filter @elysion/frontend build` (which builds the canvas element bundle first via the `prebuild` hook, then `ng build`); the runtime stage is nginx serving `dist/frontend/browser`.

## Verifying changes

`ng test --watch=false` must pass, then `pnpm --filter @elysion/frontend build` must succeed (use this, not `exec ng build`, so the canvas bundle actually gets copied in). For anything touching routing or the shell, also run `ng serve` and check the page in a browser — type-checking doesn't catch broken UI.
