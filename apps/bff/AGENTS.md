# apps/bff — Agent Instructions

NestJS Backend-for-Frontend. UI-facing aggregation over the business backend, Redis caching for heavy queries, token exchange for the realtime WebSocket handshake. TypeScript **6**, not 7 — see below.

See `docs/specs/bff.md` and `docs/adr/0001-gateway-and-bff.md`.

## Commands

```sh
pnpm --filter @elysion/bff start        # dev
pnpm --filter @elysion/bff run build    # nest build
pnpm --filter @elysion/bff test         # vitest
```

## TypeScript version — do not bump to 7

`nest build` fails outright on TypeScript 7.0.x: it needs the programmatic compiler API, which TS 7.0 doesn't expose (only ships the `tsc` binary; the API is slated to return in 7.1). This was tested directly, not assumed — see `docs/adr/0002-typescript-version-split.md`. Only revisit this once that ADR is updated to say TS 7.1+ has been verified against `@nestjs/cli`.

## Conventions

- Package name `@elysion/bff` (not `bff`) — the workspace filter and Dockerfile depend on it.
- `"files": ["dist"]` in `package.json` matters — the Dockerfile uses `pnpm deploy --prod`, which packs by `files`/gitignore rules like `npm pack`; without it, `dist/` (gitignored) is silently excluded from the deployed output.
- New guards/interceptors/modules go through Nest's standard DI patterns — nothing repo-specific here yet beyond the health endpoint pattern (`src/health.controller.ts`).

## Docker

Build from the repo root: `docker build -f apps/bff/Dockerfile -t elysion-bff .`. The build stage runs `pnpm install --filter @elysion/bff...`, `nest build`, then `pnpm deploy --prod /out` to produce a clean `node_modules` (don't try to copy `node_modules` across stages manually — pnpm's symlinks break when the directory structure changes between stages).

## Verifying changes

Build, then actually run it (`node dist/main.js`) and hit the relevant endpoint with `curl` — don't stop at "it compiles". For anything touching the Dockerfile, do a real `docker build` + `docker run` + `curl` against the container.
