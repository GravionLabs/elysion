# Elysion — Agent Instructions

Open-source Mural alternative. Monorepo: Angular + React/tldraw frontend, two NestJS services (BFF, realtime/Yjs), a .NET 10 business backend, Traefik gateway, Postgres/Redis/MinIO.

Each `apps/*` subdirectory has its own `AGENTS.md` with service-specific detail — read it before working in that app. This file covers repo-wide conventions.

## Layout

- `apps/frontend` — Angular, TypeScript 6
- `apps/gateway` — no code yet; Traefik config lives in `infra/traefik/` and `infra/docker/docker-compose.yml`
- `apps/bff` — NestJS BFF, TypeScript 6
- `apps/realtime` — NestJS WebSocket gateway (Yjs sync, presence), TypeScript 6
- `apps/business-backend` — ASP.NET Core Web API, .NET 10
- `packages/shared-types` — cross-app TS types, compiled to plain JS/d.ts (not consumed as raw `.ts`)
- `infra/` — docker-compose, Traefik config, Kubernetes manifests (future)
- `docs/adr/` — architecture decision records; `docs/specs/` — per-service specs. Read these before making an architectural change, and add/update an ADR when you make one.

## Tech stack conventions

- **Package manager: pnpm only.** Never use `npm`/`yarn` in this repo. Version pinned in root `package.json` (`packageManager`) via corepack.
- **TypeScript 6, not 7**, on every app including the Angular frontend — see `docs/adr/0002-typescript-version-split.md`. TS 7.0.x's compiler API isn't usable by `@nestjs/cli` yet; don't re-attempt TS 7 on `apps/bff`/`apps/realtime` without checking that ADR first.
- **.NET 10**, Central Package Management in `apps/business-backend` (`Directory.Packages.props` — add package versions there, not inline in `.csproj`).
- Docker builds for the Node apps use `pnpm deploy --prod` in a multi-stage build (not manual `node_modules` copying — symlinks break across stages). Follow the same pattern for new Node services.
- `pnpm-workspace.yaml` has `allowBuilds`/`onlyBuiltDependencies` entries for native postinstall scripts (esbuild, @parcel/watcher, lmdb, msgpackr-extract) — pnpm 12 refuses these by default; add new ones there if a fresh dependency needs it, don't work around it with `--ignore-scripts`.

## Workflow

- Run `pnpm dev:infra` (docker-compose: Traefik, Postgres, Redis, MinIO) before working on any backend service locally.
- Docker builds must run from the repo root (`docker build -f apps/<app>/Dockerfile .`) — Dockerfiles COPY `pnpm-workspace.yaml`/lockfile from the root.
- Verify changes actually run (build + start + hit the relevant endpoint), not just that they compile — see each app's `AGENTS.md` for its specific check.

## Issue tracking

Work is tracked on GitHub as Epic → Feature → PBI → Task (Bug → Task), using GitHub's **native sub-issues** (not manual checklists) for parent/child links — see `.github/ISSUE_TEMPLATE/`. When creating child issues, link them via the sub-issues panel/API, not a markdown checklist.
