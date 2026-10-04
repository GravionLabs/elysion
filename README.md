# Elysion

An open-source alternative to [Mural](https://mural.co): a collaborative whiteboard you can self-host. The canvas is Angular hosting a React/tldraw custom element, realtime collaboration runs on Yjs CRDTs over WebSockets, and the domain lives in a .NET backend.

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

Decisions are recorded as ADRs: [gateway and BFF](docs/adr/0001-gateway-and-bff.md), [the TypeScript version split](docs/adr/0002-typescript-version-split.md), [the .NET 10 business backend](docs/adr/0003-net10-business-backend.md). Per-service contracts live in [docs/specs/](docs/specs).

## Getting started

You need Node.js (see `.nvmrc`), [pnpm](https://pnpm.io) (pinned via `packageManager`, enabled with `corepack enable`), the [.NET 10 SDK](https://dotnet.microsoft.com) and Docker with Compose. Elysion uses pnpm only.

```sh
pnpm install      # JS/TS workspace dependencies (frontend, frontend-canvas, bff, realtime)
pnpm dev:infra    # shared infrastructure: Traefik, Postgres, Redis, MinIO
```

Run an individual service:

```sh
pnpm --filter @elysion/frontend start
pnpm --filter @elysion/bff start
pnpm --filter @elysion/realtime start

cd apps/business-backend && dotnet run --project src/Elysion.BusinessBackend.Api
```

Other commands (each runs across the whole workspace):

```sh
pnpm build           # build every app
pnpm test            # unit tests (Vitest)
pnpm lint            # oxlint
pnpm format:check    # Prettier (pnpm format fixes)
```

Each app has a `Dockerfile`; build from the repo root so the workspace files are in context:

```sh
docker build -f apps/bff/Dockerfile -t elysion-bff .
```

## Project layout

```
apps/
  frontend/          the Angular shell: routing, auth, panels around the canvas
  frontend-canvas/   the React/tldraw canvas, built as a custom element (<elysion-canvas>)
                     and embedded into the frontend — see docs/specs/frontend.md
  gateway/           Traefik-routed edge; the config lives in infra/traefik/
  bff/               NestJS Backend-for-Frontend: the API the frontend talks to
  realtime/          NestJS WebSocket gateway: Yjs document sync and presence
  business-backend/  .NET 10 Web API: domain logic, persistence, exports
packages/
  shared-types/      cross-app TS types, compiled to plain JS/d.ts
  proto/             gRPC/contract definitions (if/when used)
infra/
  docker/            docker-compose.yml (Traefik, Postgres, Redis, MinIO)
  traefik/           Traefik static config
  kubernetes/        production manifests (future)
docs/
  adr/               architecture decision records
  specs/             per-service specs
```

The repository is a pnpm workspace (`apps/*`, `packages/*`); the root scripts run across all of it. The .NET backend is not part of the workspace and builds with `dotnet`.

## Project tracking

Work is tracked on the [project board](https://github.com/users/GravionLabs/projects/7) as Epic → Feature → PBI → Task (Bug → Task), with [GitHub's native sub-issues](https://github.com/GravionLabs/elysion/issues) for parent/child links — see the issue templates in [.github/ISSUE_TEMPLATE/](.github/ISSUE_TEMPLATE).

## Contributing

- pnpm only. Never npm or yarn.
- TypeScript 6 on every app, including the Angular frontend — see [the ADR](docs/adr/0002-typescript-version-split.md) before attempting TS 7.
- Architectural changes get an ADR in `docs/adr/`.
- Branches are named `feature/<issue>-<slug>`, and commits and PRs reference the issue.
- Verify changes actually run (build, start, hit the endpoint), not just that they compile — each app's `AGENTS.md` names its specific check.

## License

[MIT](LICENSE).
