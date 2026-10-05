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

From the repo root, `pnpm build`, `pnpm test` and `pnpm lint` also run `dotnet build`, `dotnet test` and `dotnet format --verify-no-changes` for this app (root scripts `build:dotnet`, `test:dotnet`, `lint:dotnet` call `run-dotnet.mjs`; `Data/Migrations` is excluded from the format check because `dotnet ef` generates it). Inside this directory:

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
- Endpoints are **minimal APIs**, no MVC controllers: one `IEndpointRouteBuilder` extension method per feature in `Endpoints/` (`HealthEndpoints`, `BoardEndpoints`, `BoardDocumentEndpoints`) that creates a `MapGroup` with its prefix and tags and uses `TypedResults`, called from `Program.cs` — [ADR 0012](../../docs/adr/0012-minimal-apis-in-the-business-backend.md) records why this and not Carter. Request and response types are records in `Contracts/`; never return an entity (see `BoardEndpoints`). Validation that attributes cannot express stays in the handler and answers `TypedResults.ValidationProblem` (`400`, `errors.<field>`); a JSON body endpoint adds `.RequireJsonContentType()` (415 instead of 400 for a request without a JSON content type) and takes its body as an optional parameter.
- **Authentication** (docs/specs/business-backend.md, "Authentication"): every endpoint needs a Keycloak token by default (fallback policy); an endpoint that must be open says `.AllowAnonymous()` and why (`/health`; the internal document API for now). Tests use `ApiFactory.CreateAuthenticatedClient()` (a real JWT signed with a test key), `CreateClient()` for anonymous calls. Never switch off a validation flag (`ValidateIssuer = false` and the like), not even for a local run.
- **The caller** is `ICurrentUser` (a local `User`, provisioned from the token once per authenticated request by `UserProvisioningMiddleware`): inject it, do not read claims in handlers. It exists only on endpoints that require authentication; reading it on an anonymous one throws. The claim mapping lives in `UserProvisioningService` only.
- **Board authorization**: a board endpoint with `{id}` in its route declares `.RequireAuthorization(BoardPolicies.Read|Write|Administer)` and does not check roles itself. No role on the board is a `404` (never `403`, so board ids cannot be probed; `BoardAuthorizationResultHandler`); a role that is too low is `403`. Role questions go through `IBoardRepository.GetRoleAsync`; new endpoints that list or create boards use `ICurrentUser` and set the owner. See the spec's "Board authorization".
- **Repositories** ([ADR 0015](../../docs/adr/0015-business-backend-repositories.md)): endpoints and services never take `ElysionDbContext`; they take `IBoardRepository`, `IBoardDocumentRepository` and `IUnitOfWork` (`Data/Repositories/`, registered in `Program.cs`; the context is only used by the repositories and the migrations). A repository method is named for what it is for (`ListNewestFirstAsync`, `FindForUpdateAsync`), returns lists, entities or results and **never `IQueryable`**. Reads return untracked copies, `FindForUpdateAsync` returns a tracked entity; `Add` and `Remove` only stage, `IUnitOfWork.SaveChangesAsync` commits, so one request that changes two aggregates (duplicate, delete a board) is one transaction. The exception is the versioned document save: `IBoardDocumentRepository.SaveAsync` commits itself and answers `Saved`, `NotFound` or `Conflict` (ADR 0011). A new query is a new method on the aggregate's interface plus a test in `*RepositoryTests` (`SqliteDatabase`: a relational provider that enforces constraints). Revisit Ardalis.Specification under the conditions in the ADR.
- **Guard clauses** (`Ardalis.GuardClauses`, `Guard.Against…`) protect code from its callers inside the service: an entity's invariants live in its static factory (`Board.Create`, `User.Create`, `BoardMembership.Create`), and repositories and services guard their arguments. A violated guard throws (`ArgumentException` and subclasses) and means a bug, so it would be a `500`. **User input is not guarded**: a request is validated in the handler and answered with `TypedResults.ValidationProblem` (`400`); where a rule exists for both (the board name), one method owns it (`Board.TryNormalizeName`) and the factory refuses what got past it. Do not `catch` guard exceptions to turn them into `400`.
- Use the injected `TimeProvider`, not `DateTimeOffset.UtcNow`, so tests can control time.
- `TreatWarningsAsErrors` is on (`Directory.Build.props`) — a warning breaks the build, don't suppress it without a reason.

## Gotcha: Postgres 18 volume mount

`infra/docker/docker-compose.yml` mounts the postgres volume at `/var/lib/postgresql` (not `.../data`) — the `postgres:18-alpine` image's expected layout changed from earlier majors. If you bump the Postgres major version again, check the image's startup logs for a similar warning before assuming the old mount path still works.

## Docker

Build from the repo root: `docker build -f apps/business-backend/Dockerfile -t elysion-business-backend .`. Multi-stage `dotnet/sdk` build → `dotnet/aspnet` runtime. `.dockerignore` excludes `bin/`/`obj/` — without it, a locally-built `obj/` gets copied in and breaks `dotnet publish --no-restore` inside the container.

## Verifying changes

`dotnet build`, then actually run it and hit `/health` (and any new endpoint) with `curl`. For anything touching the DbContext/entities, apply the migration against the real docker-compose Postgres and check the resulting schema (`psql -U elysion -d elysion -c '\dt'`), not just that the migration file was generated. For Dockerfile changes, do a real `docker build` + `docker run` on the compose network.
