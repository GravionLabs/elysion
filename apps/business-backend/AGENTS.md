# apps/business-backend — Agent Instructions

ASP.NET Core Web API, .NET 10. Domain logic, persistence (Postgres via EF Core), templates, exports. Internal-only — no direct internet exposure, reached via the gateway/BFF only.

See `docs/specs/business-backend.md` and `docs/adr/0003-net10-business-backend.md`.

## Layout

- `Elysion.BusinessBackend.slnx` — solution file
- `src/Elysion.BusinessBackend.Api/` — the Web API project
- `tests/Elysion.BusinessBackend.Tests/` — NUnit tests (`dotnet test`); they host the app with `WebApplicationFactory<Program>` and the in-memory EF provider, see `ApiFactory`
- `Directory.Packages.props` — **all** package versions go here (Central Package Management is on: `ManagePackageVersionsCentrally=true`). Add `<PackageVersion Include="..." Version="..." />` here, then `<PackageReference Include="..." />` (no version) in the `.csproj`.
- `Directory.Build.props` — shared TFM/nullable/warnings-as-errors settings for every project under this directory.
- `dotnet-tools.json` — local tool manifest (currently just `dotnet-ef`). Use `dotnet tool run dotnet-ef ...`, not a global install.

## Commands

From the repo root, `pnpm build`, `pnpm test` and `pnpm lint` run `dotnet build`, `dotnet test` and `dotnet format --verify-no-changes` for this app (see `package.json` and `run-dotnet.mjs`; `Data/Migrations` is excluded from the format check because `dotnet ef` generates it). Inside this directory:

```sh
dotnet build
dotnet test
dotnet run --project src/Elysion.BusinessBackend.Api --no-launch-profile --urls http://localhost:5080

# migrations (Postgres must be running: pnpm dev:infra from repo root)
dotnet tool run dotnet-ef migrations add <Name> \
  --project src/Elysion.BusinessBackend.Api --startup-project src/Elysion.BusinessBackend.Api \
  --output-dir Data/Migrations
dotnet tool run dotnet-ef database update \
  --project src/Elysion.BusinessBackend.Api --startup-project src/Elysion.BusinessBackend.Api
```

Connection string is in `appsettings.Development.json` (`ConnectionStrings:Elysion`), pointing at `localhost:5432` — matches the `postgres` service in `infra/docker/docker-compose.yml`.

## Conventions

- New entities go in `Entities/`, DbContext is `Data/ElysionDbContext.cs` — add a `DbSet<T>` there and generate a migration, don't hand-write SQL.
- Controllers in `Controllers/`, `[ApiController]` + `[Route(...)]` pattern (see `HealthController`). Request and response types are records in `Contracts/`; never return an entity (see `BoardsController`).
- Use the injected `TimeProvider`, not `DateTimeOffset.UtcNow`, so tests can control time.
- `TreatWarningsAsErrors` is on (`Directory.Build.props`) — a warning breaks the build, don't suppress it without a reason.

## Gotcha: Postgres 18 volume mount

`infra/docker/docker-compose.yml` mounts the postgres volume at `/var/lib/postgresql` (not `.../data`) — the `postgres:18-alpine` image's expected layout changed from earlier majors. If you bump the Postgres major version again, check the image's startup logs for a similar warning before assuming the old mount path still works.

## Docker

Build from the repo root: `docker build -f apps/business-backend/Dockerfile -t elysion-business-backend .`. Multi-stage `dotnet/sdk` build → `dotnet/aspnet` runtime. `.dockerignore` excludes `bin/`/`obj/` — without it, a locally-built `obj/` gets copied in and breaks `dotnet publish --no-restore` inside the container.

## Verifying changes

`dotnet build`, then actually run it and hit `/health` (and any new endpoint) with `curl`. For anything touching the DbContext/entities, apply the migration against the real docker-compose Postgres and check the resulting schema (`psql -U elysion -d elysion -c '\dt'`), not just that the migration file was generated. For Dockerfile changes, do a real `docker build` + `docker run` on the compose network.
