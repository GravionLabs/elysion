# Elysion

An open-source alternative to Mural, built with Angular, React/tldraw, NestJS, Yjs, and .NET.

## Architecture

```
Frontend (Angular + React/tldraw)
        |
    Gateway (Traefik)  — TLS, auth validation, routing
    /              \
  BFF (NestJS)   Realtime (NestJS + Yjs)  — WebSocket CRDT sync, presence
    |
  Business Backend (.NET 10)  — domain logic, persistence, exports
    |
  PostgreSQL / Redis / MinIO
```

See [`docs/adr/`](docs/adr) for the reasoning behind these choices and [`docs/specs/`](docs/specs) for per-service contracts.

## Repo layout

```
apps/
  frontend/           Angular + React/tldraw canvas
  gateway/             Traefik-routed edge (config lives in infra/traefik)
  bff/                 NestJS Backend-for-Frontend
  realtime/            NestJS WebSocket gateway (Yjs sync, presence)
  business-backend/    .NET 10 Web API (domain, persistence, exports)
packages/
  shared-types/        Shared TS types, compiled to plain JS/d.ts
  proto/               gRPC/contract definitions (if/when used)
infra/
  docker/              docker-compose.yml (Traefik, Postgres, Redis, MinIO)
  traefik/             Traefik static config
  kubernetes/          Production manifests (future)
docs/
  adr/                 Architecture decision records
  specs/               Per-service specs
```

## Prerequisites

- [pnpm](https://pnpm.io) (pinned via `packageManager` in `package.json`, use `corepack use pnpm@<version>`)
- [.NET 10 SDK](https://dotnet.microsoft.com)
- Docker + Docker Compose

## Getting started

Install JS/TS dependencies for the workspace apps (`frontend`, `bff`, `realtime`):

```sh
pnpm install
```

Start shared infrastructure (Traefik, Postgres, Redis, MinIO):

```sh
pnpm dev:infra
```

Run an individual service:

```sh
pnpm --filter @elysion/bff start
pnpm --filter @elysion/realtime start
pnpm --filter @elysion/frontend start

cd apps/business-backend && dotnet run --project src/Elysion.BusinessBackend.Api
```

Each app also has a `Dockerfile`; build from the repo root so the workspace files are in context, e.g.:

```sh
docker build -f apps/bff/Dockerfile -t elysion-bff .
```

## Project tracking

Work is tracked as GitHub issues in an Epic → Feature → PBI → Task hierarchy (Bugs → Task), using [GitHub's native sub-issues](https://github.com/GravionLabs/elysion/issues) for parent/child links — see the issue templates in [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE) and the [Elysion project board](https://github.com/users/GravionLabs/projects/7).
