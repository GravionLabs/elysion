# Elysion — Agent Instructions

Open-source Mural alternative. Monorepo: Angular + React/Excalidraw frontend, two NestJS services (BFF, realtime/Yjs), a .NET 10 business backend, Traefik gateway, Postgres and RustFS (S3); Valkey comes from the shared `local-infra`.

Each `apps/*` subdirectory has its own `AGENTS.md` with service-specific detail — read it before working in that app. This file covers repo-wide conventions.

## Layout

- `apps/frontend` — Angular, TypeScript 6
- `apps/frontend-canvas` — React/Excalidraw canvas, TypeScript 6; built as a custom element (`<elysion-canvas>`) and embedded into `apps/frontend` — see `docs/specs/frontend.md`
- `apps/gateway` — no code yet; Traefik config lives in `infra/traefik/` and `infra/docker/docker-compose.yml`
- `apps/bff` — NestJS BFF, TypeScript 6
- `apps/realtime` — NestJS WebSocket gateway (Yjs sync, presence), TypeScript 6
- `apps/business-backend` — ASP.NET Core Web API, .NET 10
- `packages/shared-types` — cross-app TS types and constants (the WS token contract), compiled to plain JS/d.ts by its `prepare` script (not consumed as raw `.ts`); rebuild with `pnpm --filter @elysion/shared-types build` after editing it
- `infra/` — docker-compose, Traefik config, Kubernetes manifests (future)
- `docs/adr/` — architecture decision records; `docs/specs/` — per-service specs. Read these before making an architectural change, and add/update an ADR when you make one.

## Tech stack conventions

- **Package manager: pnpm only.** Never use `npm`/`yarn` in this repo. Version pinned in root `package.json` (`packageManager`) via corepack.
- **Formatting/linting from the root**: Prettier is configured once at the root (`.prettierrc`, no per-app configs) — run `pnpm format` / `pnpm format:check`; `pnpm lint`, `pnpm build` and `pnpm test` fan out to every workspace app via `pnpm -r --if-present`, and additionally run `dotnet build`, `dotnet test` and `dotnet format --verify-no-changes` for `apps/business-backend` through the root scripts `build:dotnet`, `test:dotnet` and `lint:dotnet` (`apps/business-backend/run-dotnet.mjs`; generated migrations are excluded from the format check). The backend is not a pnpm workspace project: pnpm 12 does not record projects without dependencies in the lockfile, which breaks `--frozen-lockfile`. **Verify a change with `pnpm format:check && pnpm lint && pnpm test && pnpm build` from the root** — that is also what CI runs.
- **Pre-commit hook**: `pnpm install` installs it (`prepare` → `simple-git-hooks`); it formats staged files with Prettier and runs oxlint on staged TypeScript (`lint-staged.config.mjs`). Do not bypass it with `--no-verify` or change the hook to make a commit pass — fix the finding. A new TypeScript app needs an entry in `lint-staged.config.mjs`.
- **TypeScript 6, not 7**, on every app including the Angular frontend — see `docs/adr/0002-typescript-version-split.md`. TS 7.0.x's compiler API isn't usable by `@nestjs/cli` yet; don't re-attempt TS 7 on `apps/bff`/`apps/realtime` without checking that ADR first.
- **.NET 10**, Central Package Management in `apps/business-backend` (`Directory.Packages.props` — add package versions there, not inline in `.csproj`).
- Docker builds for the Node apps use `pnpm deploy --prod` in a multi-stage build (not manual `node_modules` copying — symlinks break across stages). Follow the same pattern for new Node services.
- `pnpm-workspace.yaml` has `allowBuilds`/`onlyBuiltDependencies` entries for native postinstall scripts (esbuild, @parcel/watcher, lmdb, msgpackr-extract) — pnpm 12 refuses these by default; add new ones there if a fresh dependency needs it, don't work around it with `--ignore-scripts`.

## Workflow

- **CI** (`.github/workflows/ci.yml`) runs on every pull request and on pushes to `main`: `verify` (`pnpm format:check`, `pnpm lint`, `pnpm test`, `pnpm build` — the same chain you run locally), `dotnet-coverage` (NUnit with coverlet) and `e2e` (BFF and realtime e2e against a Valkey service container, plus vitest coverage). Reproduce a failing job locally with the command shown in the workflow; the e2e job needs `../local-infra`'s Valkey on port 6379. Pin new actions to a commit SHA with the version in a trailing comment.
- Run `pnpm dev:infra` (docker-compose: Traefik, Postgres, RustFS) before working on any backend service locally.
- `pnpm dev:stack` runs the four apps as containers too (compose profile `apps`, behind Traefik on port 80: `/` frontend, `/api` BFF, `/yjs` realtime); `pnpm dev:stack:down` removes everything. A routed service needs `traefik.*` labels and, if it uses Valkey, the external `local-infra` network.
- **Valkey/Redis, RabbitMQ and Portainer come from the shared `../local-infra` repo** (`docker compose up -d` there) and must never be defined in Elysion's compose file. Valkey is shared across projects: namespace every key and channel with `elysion:`. Containerized apps join the external `local-infra` network; host apps use `localhost:6379`.
- Docker builds must run from the repo root (`docker build -f apps/<app>/Dockerfile .`) — Dockerfiles COPY `pnpm-workspace.yaml`/lockfile from the root.
- Verify changes actually run (build + start + hit the relevant endpoint), not just that they compile — see each app's `AGENTS.md` for its specific check.

## Issue tracking

Work is tracked on GitHub as Epic → Feature → PBI → Task (Bug → Task), using GitHub's **native sub-issues** (not manual checklists) for parent/child links — see `.github/ISSUE_TEMPLATE/`. When creating child issues, link them via the sub-issues panel/API, not a markdown checklist. The build order is in `docs/roadmap.md`.

### Issue conventions

These apply to every issue, including issues created with `gh` or the API (which skip the issue forms). Write them in US English.

- **Labels:** exactly one level label (`epic`, `feature`, `pbi`, `task`, `bug`) and one `area:*` label.
- **Title:** `[Epic] `, `[Feature] `, `[PBI] `, `[Task] ` or `[Bug] ` matching the level label. PBIs and tasks continue with a conventional-commit title: `[PBI] feat: board list home page with New board`, `[Task] test: two clients converge`.
- **PBI body:** `### Parent Feature`, `### Acceptance criteria`, `### Depends on`, `### Verification` (commands run from the repo root), `### Sub-issues`. Add a `### How to work on this` section when the order of tasks or the AGENTS.md files to read are not obvious.
- **Task body:** `### Parent PBI or Bug`, `### Implementation notes`, `### Files`, `### Done when` (checkboxes ending with the PBI's verification). A task that needs a browser check adds `### Manual check` with how to start the stack and the exact steps.
- **Links:** parents and children as native sub-issues; dependencies between PBIs as native "blocked by" dependencies, and also listed under `### Depends on`. Refer to other issues by number, never as "the X PBI under #n".
- **ADRs:** never fix an ADR number in an issue; write "the next free ADR number" (the highest in `docs/adr/` plus one when the ADR is written).
- **Decisions:** an issue whose outcome is a product or architecture decision gets `needs-decision`. Prepare it fully and write the ADR with **Status: Proposed**; the owner accepts it and removes the label.
- **Project board:** every issue is on [project 7](https://github.com/users/GravionLabs/projects/7) with Level, Area, Status, Phase, Start date and Target date set; features, PBIs and tasks get their phase's milestone (`M1 Foundation` … `M7 Operations`), epics none.

**Definition of ready:** a PBI or task can be started when it has no `needs-refinement` or `needs-decision` label and nothing it is blocked by is still open.

**Enforcement:** the `Issue conventions` workflow (`.github/workflows/issue-conventions.yml`) fixes the title prefix and labels PBIs and tasks that miss required sections with `needs-refinement` (with a comment naming them). The `PR readiness` workflow (`.github/workflows/pr-ready.yml`) fails a pull request whose `Closes #n` issue is not ready; after a decision is accepted or a blocker is closed, re-run it. The rules live in `.github/scripts/` and are tested by `pnpm test:repo`.
