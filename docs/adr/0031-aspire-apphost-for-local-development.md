# ADR 0031: An Aspire AppHost for local development, next to compose

- Status: Proposed
- Date: 2026-10-31
- Builds on: [ADR 0023](0023-own-valkey-one-compose-file.md), [ADR 0025](0025-structured-logging-and-log-viewer.md)
- Issue: #867

## Context

Working on a service means `pnpm dev:infra` (Postgres, Keycloak, Valkey, RustFS and Traefik as containers with the host ports of
`docker-compose.dev.yml`) and then one terminal per app on the host: the business backend with `dotnet run`, the BFF and the realtime service with
`pnpm`, the frontend with `ng serve`. Nothing shows which of them is up, their logs are in four terminals, and the log viewer of ADR 0025 needs the
whole stack as containers (`pnpm dev:logs`).

[Aspire](https://aspire.dev) (13.x) is a local orchestrator: an AppHost, a C# program, declares containers, .NET projects, JavaScript apps and
executables, starts them in order, passes connection strings and URLs as environment variables and shows their state, logs and traces in a dashboard
(OTLP). Since .NET 10 an AppHost can be a single file (`apphost.cs`) without a project.

## Decision

1. **`apps/apphost/apphost.cs`** is a file-based Aspire AppHost, started with `pnpm dev:aspire` (`pnpm setup:env`, then
   `dotnet run apps/apphost/apphost.cs`). It declares what `pnpm dev:infra` starts, except Traefik (an app on the host is reached directly), **on the same host
   ports** (Postgres 5432, Keycloak 8081, Valkey 6380, RustFS 9100 and 9101), plus the business backend on 5174 (its launch profile `http`). So the
   BFF, the realtime service and the frontend run on the host with their `.env` files as before.
2. **Compose and Helm stay the source of truth** for the demo, CI, the images and production. The AppHost repeats images, versions and development
   credentials of `docker-compose.yml`; a change to one of them changes both (the comment above each resource names its counterpart).
3. **Telemetry:** the AppHost points the backend's `OTEL_EXPORTER_OTLP_LOGS_*` settings at the dashboard (OTLP over HTTP), so its log lines show up
   there without code changes. Traces and metrics need OpenTelemetry instrumentation in the services, which is not part of this decision.
4. **Keycloak keeps its data in a volume of its own** (dev-file) instead of a database in Postgres; the realms are imported from `infra/keycloak` on a
   fresh volume either way.
5. It is **optional**: `pnpm dev:infra` and `pnpm dev:stack` stay. Whether the AppHost becomes the documented default, and whether the Node apps and
   the frontend move into it (`Aspire.Hosting.JavaScript`), is decided after it has been used for a while.

## Consequences

- One command starts the infrastructure and the backend, with their state, logs and health in one place; containers start in order (`WaitFor`) instead of
  failing until their dependency is up.
- A second definition of the development infrastructure: images and settings must be kept in step with `docker-compose.yml` by hand. Renovate does not
  update the image tags of `apphost.cs`.
- The AppHost needs the .NET 10 SDK and Docker, which working on the backend needs anyway. `Aspire.Hosting.Keycloak` is a preview package.
- Fixed host ports: the AppHost and `pnpm dev:infra` (or `pnpm dev:stack`) cannot run at the same time.

## Alternatives

- **Only compose (status quo):** no extra definition, but no overview of the host apps.
- **The whole stack in the AppHost now:** the Node apps would need their settings from the AppHost and OpenTelemetry to show up in the dashboard; a larger
  change, left for later (decision 5).
- **Generate compose from the AppHost (`aspire publish`):** would make the AppHost the source of truth, but compose carries Traefik labels, profiles
  and the backup that Aspire does not model.
