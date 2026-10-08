# apps/bff — Agent Instructions

NestJS Backend-for-Frontend. UI-facing aggregation over the business backend, Redis caching for heavy queries, token exchange for the realtime WebSocket handshake. TypeScript **6**, not 7 — see below.

See `docs/specs/bff.md` and `docs/adr/0001-gateway-and-bff.md`.

## Commands

```sh
pnpm --filter @elysion/bff start        # dev
pnpm --filter @elysion/bff run build    # nest build
pnpm --filter @elysion/bff test         # vitest (unit)
pnpm --filter @elysion/bff test:e2e     # vitest (e2e, against a fake business backend)
```

## TypeScript version — do not bump to 7

`nest build` fails outright on TypeScript 7.0.x: it needs the programmatic compiler API, which TS 7.0 doesn't expose (only ships the `tsc` binary; the API is slated to return in 7.1). This was tested directly, not assumed — see `docs/adr/0002-typescript-version-split.md`. Only revisit this once that ADR is updated to say TS 7.1+ has been verified against `@nestjs/cli`.

## Conventions

- Package name `@elysion/bff` (not `bff`) — the workspace filter and Dockerfile depend on it.
- `"files": ["dist"]` in `package.json` matters — the Dockerfile uses `pnpm deploy --prod`, which packs by `files`/gitignore rules like `npm pack`; without it, `dist/` (gitignored) is silently excluded from the deployed output.
- New guards/interceptors/modules go through Nest's standard DI patterns — nothing repo-specific here yet beyond the health endpoint pattern (`src/health.controller.ts`).

## Board endpoints

`src/boards/`: `BusinessBackendClient` (Node's built-in `fetch`, no HTTP library) maps the business backend's answers to the BFF's errors, `BoardsController` serves `/api/boards`. The backend URL comes from `BUSINESS_BACKEND_URL` (default `http://localhost:5174`). The e2e tests start `test/fake-business-backend.ts`, a small in-memory copy of the Board API with the same routes and status codes, so keep it in step with `BoardsController` in the business backend. `tsc -p tsconfig.json` reports a pre-existing error for `supertest/types` in `test/app.e2e-spec.ts`; the build config (`tsconfig.build.json`) excludes the tests.

## Authentication

`src/auth/` (docs/specs/bff.md, "Authentication"): a global `AuthGuard` makes every route need a Keycloak token; only `@Public()` routes (health) are open. A handler that needs the caller's token takes `@AccessToken()` and passes it on; the business backend decides what the user may do, the BFF does not re-derive roles. Tests never reach a live Keycloak: `test/test-auth.ts` signs tokens with a local key pair, and e2e tests `overrideProvider(TokenVerifier).useValue(testVerifier())`. Never weaken the verifier (algorithm, issuer, audience, expiry) for a test or a local run.

## WS tokens and shared types

`src/realtime/` issues the board-scoped WS token (docs/specs/identity.md): it checks the caller's role with the business backend first and never signs a token for a caller without one. The token's shape (claims, issuer, audience, algorithm, roles, close codes) is defined once in `packages/shared-types` and imported from `@elysion/shared-types`; change it there, not here. That package is compiled by its `prepare` script (`pnpm install` builds it; run `pnpm --filter @elysion/shared-types build` after editing it) and the Dockerfiles copy it in before installing.

## Configuration

`src/config/`: `validateEnv` (the schema, with defaults) and `AppConfigService` (typed accessor). Read configuration only through `AppConfigService`, never from `process.env`; a new variable goes into `AppConfig`, `validateEnv`, its spec, `.env.example`, the table in `docs/specs/bff.md` and (if the container needs it) the compose file. For local runs `pnpm setup:env` (also run by `pnpm dev:infra`) creates `apps/bff/.env` (git-ignored) from `.env.example` with a random `WS_TOKEN_SECRET`: `WS_TOKEN_SECRET` has no default, so without it the BFF refuses to start and says so. Do not use `ConfigService.get('PORT')` for these values: it prefers the raw string in `process.env` over the validated one. The tests get their `WS_TOKEN_SECRET` from `vitest.config*.ts`.

## Docker

Build from the repo root: `docker build -f apps/bff/Dockerfile -t elysion-bff .`. The build stage runs `pnpm install --filter @elysion/bff...`, `nest build`, then `pnpm deploy --prod /out` to produce a clean `node_modules` (don't try to copy `node_modules` across stages manually — pnpm's symlinks break when the directory structure changes between stages).

## Verifying changes

Build, then actually run it (`node dist/main.js`) and hit the relevant endpoint with `curl` — don't stop at "it compiles". For anything touching the Dockerfile, do a real `docker build` + `docker run` + `curl` against the container.
