# Elysion

[![CI](https://github.com/GravionLabs/elysion/actions/workflows/ci.yml/badge.svg)](https://github.com/GravionLabs/elysion/actions/workflows/ci.yml)

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

Decisions are recorded as ADRs: [gateway and BFF](docs/adr/0001-gateway-and-bff.md), [the TypeScript version split](docs/adr/0002-typescript-version-split.md), [the .NET 10 business backend](docs/adr/0003-net10-business-backend.md), [the canvas library](docs/adr/0004-canvas-library.md), [the canvas follows ariadne's design](docs/adr/0005-canvas-follows-ariadne-design.md), [shared local infrastructure](docs/adr/0006-shared-local-infrastructure.md), [RustFS instead of MinIO](docs/adr/0007-rustfs-replaces-minio.md), [repository tooling conventions](docs/adr/0008-repository-tooling-conventions.md), [state in the Angular shell](docs/adr/0009-angular-shell-state.md), [the shell controls the canvas](docs/adr/0010-shell-controls-the-canvas.md), [board document persistence](docs/adr/0011-board-document-persistence.md), [minimal APIs in the business backend](docs/adr/0012-minimal-apis-in-the-business-backend.md) Per-service contracts live in [docs/specs/](docs/specs), [PDF export in the browser](docs/adr/0013-pdf-export.md), [Keycloak as the identity provider](docs/adr/0014-keycloak-identity-provider.md), [repositories in the business backend](docs/adr/0015-business-backend-repositories.md), [the Angular OIDC library](docs/adr/0016-angular-oidc-library.md), [authenticating the internal API](docs/adr/0017-internal-api-authentication.md), [Kubernetes packaging: Helm](docs/adr/0018-kubernetes-packaging.md).

## Getting started

You need Node.js (see `.nvmrc`), [pnpm](https://pnpm.io) (pinned via `packageManager`, enabled with `corepack enable`), the [.NET 10 SDK](https://dotnet.microsoft.com) and Docker with Compose. Elysion uses pnpm only.

```sh
pnpm install      # JS/TS workspace dependencies (frontend, frontend-canvas, bff, realtime)
pnpm dev:infra    # Elysion's own infrastructure: Traefik, Postgres, RustFS, Keycloak (http://localhost:8081, realm `elysion`, dev user `dev` / `dev`, ADR 0014)
pnpm dev:stack    # the whole stack in containers behind Traefik: http://localhost/
```

`pnpm dev:stack` builds and starts the frontend, BFF, realtime and business backend as containers next to the infrastructure; it needs local-infra running (`cd ../local-infra && docker compose up -d`) and fails with a hint otherwise. Traefik serves everything on port 80: `/` is the Angular app, `/api` the BFF, `/yjs` the realtime WebSocket; the business backend is only reachable from the BFF. `pnpm dev:stack:down` stops and removes everything again. The app asks you to log in (Keycloak, dev user `dev` / `dev`, and `guest` / `guest` to share a board with, see above); boards from before users existed (no owner) are not listed, see docs/specs/business-backend.md. Use `pnpm dev:infra` instead when you run the apps on the host.

To check that the stack works: `curl -fsS http://localhost/api/boards` answers with a JSON list, `http://localhost/` opens the app, and a board created with `curl -X POST -H 'content-type: application/json' -d '{"name":"Check"}' http://localhost/api/boards` opens at the `path` it returns, with the name in the top bar and the status "Connected". Open that URL in two windows and draw in one to see the other follow.

Run an individual service (the BFF needs its environment first: `cp apps/bff/.env.example apps/bff/.env`, once):

```sh
pnpm --filter @elysion/frontend start
pnpm --filter @elysion/bff start
pnpm --filter @elysion/realtime start

cd apps/business-backend && dotnet run --project src/Elysion.BusinessBackend.Api
```

Other commands (each runs across the whole workspace):

```sh
pnpm build           # build every app, including the .NET solution
pnpm test            # unit tests: Vitest, NUnit, and the repo scripts' node tests
pnpm lint            # oxlint, and the JetBrains formatter check (`jb cleanupcode`) for the backend's C#
pnpm format:dotnet  # formats the backend's C# with the JetBrains tools (Prettier does the rest: `pnpm format`)
pnpm format:check    # Prettier (pnpm format fixes)
```

To verify a change as a whole, run `pnpm format:check && pnpm lint && pnpm test && pnpm build` (CI runs the same commands). CI (`.github/workflows/ci.yml`) has three jobs: that command chain; the .NET tests with a coverage report; and the BFF and realtime end-to-end tests against a Valkey service container, plus their coverage. Coverage reports are uploaded as workflow artifacts; there is no threshold yet. The .NET parts need the .NET 10 SDK; the realtime end-to-end tests need local-infra's Valkey (`pnpm --filter @elysion/realtime test:e2e`).

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

The BFF reaches the business backend at `BUSINESS_BACKEND_URL` (default `http://localhost:5174`, the port in the table). Run `pnpm install` once, and have Docker running. `ng serve` proxies `/api` to the BFF (3000) and `/yjs` to realtime (3001) through `apps/frontend/proxy.conf.json`, read when it starts, so the Angular app and a second tab on the same board URL work without extra parameters. The frontend configuration starts `canvas: watch element` first, which rebuilds the `<elysion-canvas>` bundle on every change and refreshes `apps/frontend/public/canvas`, so a reload of the Angular app shows the current canvas. Without it that folder is only a copy made at start and goes stale; outside VS Code run `pnpm --filter @elysion/frontend-canvas build:element:watch` next to `pnpm --filter @elysion/frontend start`. The C# configuration needs the [C# Dev Kit](https://marketplace.visualstudio.com/items?itemName=ms-dotnettools.csdevkit) (recommended in `.vscode/extensions.json`).

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
  traefik/           Traefik static config and dynamic middlewares (edge authentication)
  kubernetes/        production manifests (future)
docs/
  adr/               architecture decision records
  specs/             per-service specs
```

The repository is a pnpm workspace (`apps/*`, `packages/*`); the root scripts run across all of it. The .NET backend is not part of the workspace and builds with `dotnet`.

## Pre-commit hook

`pnpm install` installs a git pre-commit hook (`simple-git-hooks`, configured in the root `package.json`) that runs [lint-staged](lint-staged.config.mjs) on the staged files only: Prettier rewrites them, and oxlint with the app's own `oxlint.json` checks staged TypeScript files and blocks the commit on any finding. It takes a second or two. C# files are not checked in the hook, because the JetBrains formatter needs about 40 seconds for the solution; `pnpm lint` and CI cover them.

In an emergency, skip the hook with `git commit --no-verify`; CI runs the same checks, so the problem will show up there.

## Project tracking

Work is tracked on the [project board](https://github.com/users/GravionLabs/projects/7) as Epic → Feature → PBI → Task (Bug → Task), with [GitHub's native sub-issues](https://github.com/GravionLabs/elysion/issues) for parent/child links — see the issue templates in [.github/ISSUE_TEMPLATE/](.github/ISSUE_TEMPLATE). The order in which the open backlog is built is in [docs/roadmap.md](docs/roadmap.md); the board's **Phase** field mirrors it. How issues are written, when they are ready, and how that is enforced is in [AGENTS.md → Issue conventions](AGENTS.md#issue-conventions).

## Contributing

- pnpm only. Never npm or yarn.
- TypeScript 6 on every app, including the Angular frontend — see [the ADR](docs/adr/0002-typescript-version-split.md) before attempting TS 7.
- Architectural changes get an ADR in `docs/adr/`.
- Branches are named `feature/<issue>-<slug>`, and commits and PRs reference the issue.
- Verify changes actually run (build, start, hit the endpoint), not just that they compile — each app's `AGENTS.md` names its specific check.

## License

[MIT](LICENSE).
