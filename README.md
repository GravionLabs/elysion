# Elysion

![The Elysion icon](apps/frontend/public/icon.svg)

[![CI](https://github.com/GravionLabs/elysion/actions/workflows/ci.yml/badge.svg)](https://github.com/GravionLabs/elysion/actions/workflows/ci.yml)

An open-source alternative to [Mural](https://mural.co): a collaborative whiteboard you can self-host. Several people draw on the same board at the same time and see each other's cursors; boards are kept, shared with roles, grouped in rooms and started from templates; and a facilitator can run a timer and a dot voting. It is a **pre-release**: it works end to end, but it is not yet a production setup (see [What is missing](#what-is-missing)).

## What it does

- **Boards:** a board overview with rooms (shared spaces for a team), create, rename, duplicate and delete; sharing with the roles owner, editor and viewer (per board and per room); built-in templates and your own, applied when a board is created or added to one; PDF, PNG, SVG and `.excalidraw` export and an `.excalidraw` import.
- **The canvas** ([Excalidraw](https://excalidraw.com) in the ariadne look, light and dark): shapes, text, drawing, sticky notes with a remembered color and one-click creation, **connectors** with connection points, a grid with snapping, a minimap, undo and redo, and the cursors, names and avatars of everybody on the board.
- **Realtime:** every change is merged by Yjs CRDTs over WebSockets (several realtime instances stay in step through Valkey); boards are persisted and survive a restart.
- **Facilitation:** a **shared timer** with a countdown for everybody, and **dot voting** (votes per person, your own dots while it runs, a ranked result in a movable dialog when it ends, by the facilitator or when everybody has voted). Viewers see both and cannot vote.
- **Identity:** login through Keycloak; the BFF, the realtime service and the business backend each check the token, and a viewer's changes are refused by the server, not only hidden in the interface.
- **Operations:** Traefik at the edge with CORS and rate limits, metrics and structured logs, a Helm chart ([ADR 0018](docs/adr/0018-kubernetes-packaging.md)).

## Try it

With Docker, in one command and with nothing else installed (the images are built from this checkout):

```sh
pnpm demo        # = `docker compose up -d --build`, then open http://localhost and log in as dev, dev1 or dev2 (the password is the username)
pnpm demo:down   # = `docker compose down`
```

The [Demo](#demo) section has the details. How to use it is in the [user guide](docs/user-guide.md). The published images and what a real deployment needs are in [self-hosting](docs/self-hosting.md); every merge to `main` is a (pre-)release with images on GHCR ([ADR 0021](docs/adr/0021-versioning-and-releases.md)). The documentation is also a website (`apps/site`, [ADR 0022](docs/adr/0022-documentation-site.md)) at <https://gravionlabs.github.io/elysion/> once GitHub Pages is switched on. To work on Elysion see [Getting started](#getting-started).

## What is missing

Known gaps, so nobody finds them by surprise (the [roadmap](docs/roadmap.md) says what comes next):

- **Not a production setup:** the demo and the development stack run Keycloak in development mode, wired to `localhost`, with development secrets. A real deployment needs TLS, a host name, a production Keycloak and its own secrets (see [self-hosting](docs/self-hosting.md)).
- **Voting is not secret from the server:** with the votes in the board's document (ADR 0020) the interface shows no names while a voting runs and only counts afterwards, but the document holds who voted for what, and viewers cannot vote.
- **Timer clocks** of two clients may differ by a few seconds (the end is worked out on every client).
- **Images are PNG, JPEG, GIF or WebP** up to 10 MiB, 200 per board (SVG is refused: it can carry script). They are kept in the object store (RustFS in the stack).
- **Backup is a service you start** (`docker compose --profile backup up -d backup`, [self-hosting](docs/self-hosting.md#back-up-and-restore)): nightly dumps of the databases and a copy of the images, on the same host unless you point it elsewhere, with no alert yet when one fails (#687).
- **Cards show initials**, not thumbnails of the board.
- **Dark theme:** Excalidraw darkens all colors on a dark canvas, so a sticky note is a darker shade than its pastel color in the light theme.
- **Browser tests cover the main paths, not every corner:** `apps/e2e` (Playwright, two browsers on one board, against the container stack in CI) covers sharing, the timer, the dot voting, a viewer's limits, images, rooms, templates, import and export, the drawing tools with connectors and undo, and losing and regaining the connection; there is no visual regression test and only Chromium is used.

## Architecture

```
Frontend (Angular + React/Excalidraw)
        |
    Gateway (Traefik)  — edge authentication, CORS, rate limits, routing
    /              \
  BFF (NestJS)   Realtime (NestJS + Yjs)  — WebSocket CRDT sync, presence
    |
  Business Backend (.NET 10)  — domain logic, persistence, authorization
    |
  PostgreSQL / Valkey (realtime) / Keycloak (identity)
```

Decisions are recorded as ADRs: [gateway and BFF](docs/adr/0001-gateway-and-bff.md), [the TypeScript version split](docs/adr/0002-typescript-version-split.md), [the .NET 10 business backend](docs/adr/0003-net10-business-backend.md), [the canvas library](docs/adr/0004-canvas-library.md), [the canvas follows ariadne's design](docs/adr/0005-canvas-follows-ariadne-design.md), [shared local infrastructure](docs/adr/0006-shared-local-infrastructure.md), [RustFS instead of MinIO](docs/adr/0007-rustfs-replaces-minio.md), [repository tooling conventions](docs/adr/0008-repository-tooling-conventions.md), [state in the Angular shell](docs/adr/0009-angular-shell-state.md), [the shell controls the canvas](docs/adr/0010-shell-controls-the-canvas.md), [board document persistence](docs/adr/0011-board-document-persistence.md), [minimal APIs in the business backend](docs/adr/0012-minimal-apis-in-the-business-backend.md) Per-service contracts live in [docs/specs/](docs/specs), [PDF export in the browser](docs/adr/0013-pdf-export.md), [Keycloak as the identity provider](docs/adr/0014-keycloak-identity-provider.md), [repositories in the business backend](docs/adr/0015-business-backend-repositories.md), [the Angular OIDC library](docs/adr/0016-angular-oidc-library.md), [authenticating the internal API](docs/adr/0017-internal-api-authentication.md), [Kubernetes packaging: Helm](docs/adr/0018-kubernetes-packaging.md), [grouping boards](docs/adr/0019-grouping-boards.md), [facilitation state](docs/adr/0020-facilitation-state.md), [versioning and releases](docs/adr/0021-versioning-and-releases.md), [Elysion's own Valkey and one compose file](docs/adr/0023-own-valkey-one-compose-file.md), [the documentation site](docs/adr/0022-documentation-site.md).

## Getting started

You need Node.js (see `.nvmrc`), [pnpm](https://pnpm.io) (pinned via `packageManager`, enabled with `corepack enable`), the [.NET 10 SDK](https://dotnet.microsoft.com) and Docker with Compose. Elysion uses pnpm only.

```sh
pnpm install      # JS/TS workspace dependencies (frontend, frontend-canvas, bff, realtime)
pnpm kind:up      # the same services on a local kind cluster with the Helm chart (infra/kind/README.md)
pnpm dev:infra    # only the infrastructure, for apps on the host: Traefik, Postgres, Keycloak (http://localhost:8081, realm `elysion`, dev user `dev` / `dev`, ADR 0014), Valkey (localhost:6380) and RustFS
pnpm dev:stack    # the whole stack in containers behind Traefik: http://localhost/
pnpm dev:logs     # the same, plus a log viewer for all four components: http://localhost:9428/select/vmui
```

`pnpm dev:stack` builds and starts the whole stack as containers behind Traefik, the same stack as `docker compose up -d --build` with the host ports of `docker-compose.dev.yml` on top (Postgres on 5432, Valkey on 6380, the Traefik dashboard on 8080); nothing else has to be running. Traefik serves everything on port 80: `/` is the Angular app, `/api` the BFF, `/yjs` the realtime WebSocket; the business backend is only reachable from the BFF. `pnpm dev:stack:down` stops and removes the containers (the data volumes stay). The app asks you to log in (Keycloak, dev user `dev` / `dev`, and `guest` / `guest` to share a board with, see above); boards from before users existed (no owner) are not listed, see docs/specs/business-backend.md. Use `pnpm dev:infra` instead when you run the apps on the host.

### Demo

`docker compose up -d` (or `pnpm demo`, which also builds the images from the checkout) starts **the whole of Elysion with one command** and nothing else installed or running except Docker (`docker-compose.yml`, [ADR 0023](docs/adr/0023-own-valkey-one-compose-file.md)): the four apps, Traefik, Postgres, Keycloak and **Valkey**, the image and settings of `local-infra`'s but Elysion's own (a volume of its own, no host port). Without `--build` it runs the published images (`ELYSION_VERSION`, `next` by default; [self-hosting](docs/self-hosting.md)); with it, the images are built from the checkout, which takes a few minutes the first time. Then open http://localhost and log in as **`dev`**, **`dev1`** or **`dev2`** (the password is the username), for example to share a board or a room between two browsers. Keycloak's admin console is at http://localhost:8081 (`admin` / `admin`, for managing the realm only). `docker compose down` stops it and keeps the data; `docker compose down -v` forgets everything. Settings are in `.env` (copy `.env.example`). It is wired to `localhost` (dev-mode Keycloak, development secrets: not a production setup). `dev1` and `dev2` are in the realm file, but an existing Keycloak database keeps the realm it imported first: they appear there after `DROP DATABASE keycloak` and a restart of Keycloak.

To check that the stack works: `curl -fsS http://localhost/api/boards` answers with a JSON list, `http://localhost/` opens the app, and a board created with `curl -X POST -H 'content-type: application/json' -d '{"name":"Check"}' http://localhost/api/boards` opens at the `path` it returns, with the name in the top bar and the status "Connected". Open that URL in two windows and draw in one to see the other follow.

Run an individual service (the BFF and the realtime service need their `.env` first: `pnpm setup:env`, once; `pnpm dev:infra` runs it too. It copies each `.env.example` with fresh random secrets and keeps the backend's `INTERNAL_API_SECRET` in sync through .NET user secrets):

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

The browser tests (`apps/e2e`) need the running stack: `pnpm demo`, then `pnpm test:browser` (see its `AGENTS.md`). To verify a change as a whole, run `pnpm format:check && pnpm lint && pnpm test && pnpm build` (CI runs the same commands). CI (`.github/workflows/ci.yml`) has three jobs: that command chain; the .NET tests with a coverage report; and the BFF and realtime end-to-end tests against a Valkey service container, plus their coverage. Coverage reports are uploaded as workflow artifacts; there is no threshold yet. The .NET parts need the .NET 10 SDK; the realtime end-to-end tests need a Valkey: `pnpm dev:infra` starts the stack's on `localhost:6380`, so run them with `REDIS_URL=redis://localhost:6380 pnpm --filter @elysion/realtime test:e2e` (CI uses a service container on 6379).

Each app has a `Dockerfile`; build from the repo root so the workspace files are in context:

```sh
docker build -f apps/bff/Dockerfile -t elysion-bff .
```

## Run and debug in VS Code

`.vscode/launch.json` has a configuration per service and a compound that starts everything with F5:

| Configuration         | What it starts                                                               | Port | Debugger |
| --------------------- | ---------------------------------------------------------------------------- | ---- | -------- |
| `frontend (Chrome)`   | `ng serve` (builds the canvas bundle first), opens Chrome                    | 4200 | Chrome   |
| `bff`                 | `nest start --debug --watch`                                                 | 3000 | 9229     |
| `realtime`            | `nest start --debug=9230 --watch` with `PORT=3001`                           | 3001 | 9230     |
| `business-backend`    | the .NET API (`dotnet build` first), `Development` environment               | 5174 | coreclr  |
| `Elysion: full stack` | runs `pnpm dev:infra`, then business-backend, bff, realtime and the frontend | -    | all      |

The BFF reaches the business backend at `BUSINESS_BACKEND_URL` (default `http://localhost:5174`, the port in the table). Run `pnpm install` once, and have Docker running. `ng serve` proxies `/api` to the BFF (3000) and `/yjs` to realtime (3001) through `apps/frontend/proxy.conf.json`, read when it starts, so the Angular app and a second tab on the same board URL work without extra parameters. The frontend configuration starts `canvas: watch element` first, which rebuilds the `<elysion-canvas>` bundle on every change and refreshes `apps/frontend/public/canvas`, so a reload of the Angular app shows the current canvas. Without it that folder is only a copy made at start and goes stale; outside VS Code run `pnpm --filter @elysion/frontend-canvas build:element:watch` next to `pnpm --filter @elysion/frontend start`. The C# configuration needs the [C# Dev Kit](https://marketplace.visualstudio.com/items?itemName=ms-dotnettools.csdevkit) (recommended in `.vscode/extensions.json`).

### Valkey, ports and the other machine-wide services

Valkey is **Elysion's own**: `docker-compose.yml` defines it with the image and the settings of `local-infra`'s Valkey, so the stack needs nothing from the machine ([ADR 0023](docs/adr/0023-own-valkey-one-compose-file.md), which replaces the sharing of ADR 0006). RabbitMQ, Portainer and other projects' services stay in [`local-infra`](../local-infra), and Elysion does not need them.

- Containers reach Valkey at `valkey:6379`. Apps on the host use `REDIS_URL=redis://localhost:6380`: `pnpm dev:infra` publishes it on **6380** (`VALKEY_PORT`), not 6379, so it cannot clash with a Valkey of `local-infra` on the machine. The realtime service's default is `redis://localhost:6379` (what CI's service container has); `apps/realtime/.env.example` and the VS Code configuration set 6380.
- Everything Elysion stores in Valkey is still prefixed with `elysion:` (for example `elysion:presence:<board>`).
- RustFS (reserved, no app uses it yet) is only in `docker-compose.dev.yml`, on 9100 (S3) and 9101 (console), because Portainer from `local-infra` may own 9000. If a port is taken on your machine, copy `.env.example` to `.env` and change it.

## Project layout

```
docker-compose.yml     the whole stack in one file, Valkey included (ADR 0023); docker-compose.dev.yml adds host ports;
                       .env.example lists the settings
apps/
  frontend/          the Angular shell: routing, auth, panels around the canvas
  frontend-canvas/   the React/Excalidraw canvas, built as a custom element (<elysion-canvas>)
                     and embedded into the frontend — see docs/specs/frontend.md
  gateway/           Traefik-routed edge; the config lives in infra/traefik/
  bff/               NestJS Backend-for-Frontend: the API the frontend talks to
  realtime/          NestJS WebSocket gateway: Yjs document sync and presence
  business-backend/  .NET 10 Web API: domain logic, persistence, exports
packages/
  shared-types/      cross-app TS types, compiled to plain JS/d.ts
  node-logging/      the JSON log line and request id of the Node services (pino-http options)
  design-tokens/     the colors, radii and shadows shared by the shell and the canvas
infra/
  traefik/           Traefik static config and dynamic middlewares (edge authentication)
  helm/              the Helm chart (ADR 0018)
  kind/              a local Kubernetes cluster with the chart
  keycloak/          the realm (users, clients)
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
