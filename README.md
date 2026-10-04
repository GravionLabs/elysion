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
  PostgreSQL / Valkey (shared) / RustFS (S3-compatible object store)
```

Decisions are recorded as ADRs: [gateway and BFF](docs/adr/0001-gateway-and-bff.md), [the TypeScript version split](docs/adr/0002-typescript-version-split.md), [the .NET 10 business backend](docs/adr/0003-net10-business-backend.md), [the canvas library](docs/adr/0004-canvas-library.md), [the canvas follows ariadne's design](docs/adr/0005-canvas-follows-ariadne-design.md), [shared local infrastructure](docs/adr/0006-shared-local-infrastructure.md), [RustFS instead of MinIO](docs/adr/0007-rustfs-replaces-minio.md), [repository tooling conventions](docs/adr/0008-repository-tooling-conventions.md). Per-service contracts live in [docs/specs/](docs/specs).

## Getting started

You need Node.js (see `.nvmrc`), [pnpm](https://pnpm.io) (pinned via `packageManager`, enabled with `corepack enable`), the [.NET 10 SDK](https://dotnet.microsoft.com) and Docker with Compose. Elysion uses pnpm only.

```sh
pnpm install      # JS/TS workspace dependencies (frontend, frontend-canvas, bff, realtime)
pnpm dev:infra    # Elysion's own infrastructure: Traefik, Postgres, RustFS
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

## Run and debug in VS Code

`.vscode/launch.json` has a configuration per service and a compound that starts everything with F5:

| Configuration         | What it starts                                                                                   | Port | Debugger |
| --------------------- | ------------------------------------------------------------------------------------------------ | ---- | -------- |
| `frontend (Chrome)`   | `ng serve` (builds the canvas bundle first), opens Chrome                                        | 4200 | Chrome   |
| `bff`                 | `nest start --debug --watch`                                                                     | 3000 | 9229     |
| `realtime`            | `nest start --debug=9230 --watch` with `PORT=3001`                                               | 3001 | 9230     |
| `business-backend`    | the .NET API (`dotnet build` first), `Development` environment                                   | 5174 | coreclr  |
| `Elysion: full stack` | checks local-infra, runs `pnpm dev:infra`, then business-backend, bff, realtime and the frontend | -    | all      |

Run `pnpm install` once, and have Docker running. The C# configuration needs the [C# Dev Kit](https://marketplace.visualstudio.com/items?itemName=ms-dotnettools.csdevkit) (recommended in `.vscode/extensions.json`).

### Shared local infrastructure

Valkey (Redis), RabbitMQ and Portainer are not part of this repository: they run once per machine from [`local-infra`](../local-infra) (`docker compose up -d` there) and are shared by all local projects. Elysion must not define them again.

- Apps on the host reach Valkey at `localhost:6379` (`REDIS_URL` overrides it); containers join the external `local-infra` network and use `valkey:6379`.
- Valkey is shared, so everything Elysion stores is prefixed with `elysion:` (for example `elysion:presence:<board>`), as local-infra's multi-tenancy convention asks.
- Portainer owns host port 9000, which is why RustFS listens on 9100 (S3) and 9101 (console). If a port is taken on your machine, copy `infra/docker/.env.example` to `infra/docker/.env` and change it.
- `Elysion: full stack` first checks that the local-infra Valkey container is running and stops with a hint otherwise.

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
  docker/            docker-compose.yml (Traefik, Postgres, RustFS)
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
