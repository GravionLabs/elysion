# apps/frontend — Agent Instructions

Angular 22 app, TypeScript 6. Will embed a React/tldraw canvas and a Yjs client — not yet wired in; currently a shell (`App` component, header + `router-outlet`) with a single placeholder route rendering `Board` (`src/app/board/`), the eventual canvas embed point.

See `docs/specs/frontend.md` and `docs/adr/0002-typescript-version-split.md`.

## Commands

```sh
pnpm --filter @elysion/frontend start   # dev server
pnpm --filter @elysion/frontend exec ng build
pnpm --filter @elysion/frontend exec ng test --watch=false
```

## Conventions

- Standalone components only (no NgModules) — this is the Angular CLI default for new components; keep it that way.
- Package name is `@elysion/frontend`, not `frontend` — the workspace filter and Dockerfile depend on this.
- TypeScript stays on 6.x — see the root `AGENTS.md` and `docs/adr/0002-typescript-version-split.md` before bumping.
- Don't add SSR — this app is scaffolded with `--ssr=false` and the Dockerfile serves a static build through nginx (`nginx.conf` has the SPA `try_files` fallback).

## Docker

Build from the repo root: `docker build -f apps/frontend/Dockerfile -t elysion-frontend .` — the build stage runs `pnpm install --filter @elysion/frontend...` against the workspace root, then `ng build`; the runtime stage is nginx serving `dist/frontend/browser`.

## Verifying changes

`ng test --watch=false` must pass, then `ng build` must succeed. For anything touching routing or the shell, also run `ng serve` and check the page in a browser — type-checking doesn't catch broken UI.
