# apps/apphost — Agent Instructions

The Aspire AppHost of the development stack ([ADR 0030](../../docs/adr/0030-aspire-apphost-for-local-development.md), Proposed). One file, `apphost.cs`, a file-based .NET 10 app: its `#:sdk` and `#:package` lines are the dependencies (no project file, no `Directory.Packages.props`). `apphost.run.json` is its launch profile (the dashboard and its OTLP ports).

## Commands

```sh
pnpm dev:aspire                          # from the repo root: pnpm setup:env, then dotnet run apps/apphost/apphost.cs; prints the dashboard URL
dotnet build apps/apphost/apphost.cs     # compile only
```

`pnpm dev:infra` and `pnpm dev:stack` use the same host ports: stop them first (`pnpm dev:infra:down`, `pnpm dev:stack:down`).

## What it starts

| Resource                                      | Host port                 | Counterpart                        |
| :-------------------------------------------- | :------------------------ | :--------------------------------- |
| `postgres` (18-alpine), database `elysion`    | 5432                      | `postgres` in `docker-compose.yml` |
| `valkey` (password)                           | 6380                      | `valkey`                           |
| `keycloak` (26.6, realms of `infra/keycloak`) | 8081                      | `keycloak`                         |
| `rustfs`                                      | 9100 (S3), 9101 (console) | `rustfs`                           |
| `business-backend` (launch profile `http`)    | 5174                      | `business-backend`                 |

Not in it: Traefik, the BFF, the realtime service, the frontend (run them on the host as before), the log viewer, the backup.

## Rules

- **Keep it in step with `docker-compose.yml`:** an image, a version or a development credential changed there is changed here too, and the other way round. Renovate does not update `apphost.cs`.
- **Never set `INTERNAL_API_SECRET` here:** the backend reads it from its user secrets (`pnpm setup:env`), which the realtime service's `.env` shares (ADR 0017).
- The host ports are those of `docker-compose.dev.yml` on purpose, so the host apps need no other `.env`.
- Postgres 18 mounts its volume at `/var/lib/postgresql`, not Aspire's default `.../data` (`WithDataVolume` would use the wrong path).
- Verify a change by starting it: `curl -fsS http://localhost:5174/health` and `curl -fsS http://localhost:8081/realms/elysion/.well-known/openid-configuration`.
