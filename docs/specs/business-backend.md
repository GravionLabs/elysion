# Business backend spec (.NET 10)

## Owner

Backend

## Responsibilities

Domain logic, persistence (PostgreSQL), templates, export service (PNG/PDF). Internal-only, exposed via gateway/BFF. See ADR 0003.

## Services (draft)

- Auth service (JWT/OIDC validation; tokens are issued by Keycloak, ADR 0014)
- Board service (CRUD)
- Template service
- Export service

## Board API

The board endpoints (`/boards`, minimal APIs in `Endpoints/BoardEndpoints.cs`) are the Board service. It returns and accepts DTOs (`Contracts/BoardContracts.cs`); the `Board` entity is never exposed. Reached through the BFF only.

| Request                                  | Result                                                |
| ---------------------------------------- | ----------------------------------------------------- |
| `POST /boards` `{ "name": "..." }`       | `201` with a `Location` header and the board          |
| `GET /boards`                            | `200`, all boards, newest first                       |
| `GET /boards/{id}`                       | `200` or `404`                                        |
| `PATCH /boards/{id}` `{ "name": "..." }` | `200` with the renamed board, or `404`                |
| `POST /boards/{id}/duplicate`            | `201` with the copy and a `Location` header, or `404` |
| `DELETE /boards/{id}`                    | `204` or `404`                                        |

A board is `{ id, name, createdAt }`. The name is trimmed and must be 1 to 120 characters; otherwise the answer is `400` with problem details (`errors.name`). A route id that is not a GUID is a `404`. `createdAt` is cut to microseconds, which is what Postgres keeps, so a create and every later read show the same value.

Board access is governed by roles, see "Board authorization" below: the list holds only the caller's boards, and every other board endpoint needs a role on the board.

**Duplicate** creates a board named "<name> (copy)" (the name is cut short, to 120 characters, when the suffix would not fit) and copies the source's stored document byte for byte as a fresh document (version 1), so the two boards are independent from then on. The copy is what was last saved: changes still inside a room's save window (a few seconds) are not in it yet. A board without content gets a copy without a document.

## Template API

Templates (`Template`: `Id`, `Name`, `Description`, `Scene`, `IsBuiltIn`, `CreatedAt`) are starting points for boards. `Scene` is the text of an `.excalidraw` file. Minimal APIs in `Endpoints/TemplateEndpoints.cs`, any signed-in user may read:

| Request               | Result                                                                  |
| --------------------- | ----------------------------------------------------------------------- |
| `GET /templates`      | `200`, built-in templates first, then by name; each without its `scene` |
| `GET /templates/{id}` | `200` with the template including `scene`, or `404` (a non-GUID id too) |

The built-in templates (Retrospective, Kanban, Brainstorming) are seeded by the `AddTemplates` migration from the embedded `Templates/*.excalidraw` files (made of the canvas's sticky notes), with fixed ids, so every database has the same ones. The notes in the scenes carry the canvas's note look (the color as the background, a darker border; see "Sticky notes" in the frontend spec); `UpdateBuiltInTemplateColors` brought them to it. Changing a built-in scene means a new migration (`dotnet ef migrations add ...` updates the seed through `HasData`).

## Authentication

Every endpoint requires a Keycloak access token (`Authorization: Bearer ...`, [identity.md](identity.md), [ADR 0014](../adr/0014-keycloak-identity-provider.md)): JWT bearer authentication runs before authorization, and the fallback policy demands an authenticated user for anything that does not say `AllowAnonymous`. A request without a valid token is `401` with `WWW-Authenticate: Bearer`. The service validates tokens and never issues them.

- **Validation is explicit and always on**, also in Development: signature (`RequireSignedTokens`, an `alg: none` token is refused), issuer (`OIDC_ISSUER_URL`), audience (`OIDC_AUDIENCE`, `elysion-bff`), expiry (30 seconds of clock skew).
- **Configuration** is bound to `OidcOptions` under the names of the other services: `OIDC_ISSUER_URL` and `OIDC_AUDIENCE` (required: the service does not start without them; development values are in `appsettings.Development.json`, the compose file sets them for the container) and the optional `OIDC_JWKS_URI`.
- **Signing keys** come from the realm, never from configuration. By default through the issuer's discovery document. Inside the compose network the issuer in the tokens is `http://localhost:8081/...`, which the container cannot reach, so `OIDC_JWKS_URI` points at `http://keycloak:8080/.../certs` and `JwksConfigurationManager` takes the keys from there (cached for an hour, fetched again when a token names an unknown key, at most every 30 seconds).
- **Anonymous endpoints:** `/health` (container health checks) and the OpenAPI document in Development. Nothing else is open.
- **The internal document API** `/internal/boards/{boardId}/document` takes **only the realtime service's own token** ([ADR 0017](../adr/0017-internal-api-authentication.md)): a JWT signed by the realtime service with the secret both services share (`INTERNAL_API_SECRET`, at least 32 characters, required: the service does not start without it, and never the value of `WS_TOKEN_SECRET`), HS256 only, issuer `elysion-realtime`, audience `elysion-backend-internal`, valid for a minute (5 seconds of clock skew). A second authentication scheme (`Internal`) validates it and the policy `InternalService` requires that scheme, so a user's Keycloak token does not open `/internal` and the service's token opens nothing else (every other endpoint validates Keycloak tokens only). The service is no user: its requests are not provisioned. `/internal` is also not routed at the edge; the token is the second lock. The values of the claims are in `@elysion/shared-types` (`internal-token.ts`) and `InternalApiOptions`: change them in both places.
- **The audience** is not in Keycloak's default access tokens. The realm file gives `elysion-frontend` an audience mapper for `elysion-bff`; a realm imported before that change needs `DROP DATABASE keycloak` and a restart of Keycloak to pick it up.
- **Tests** use real JWTs signed with a key made for the run (`ApiFactory.CreateToken`, `CreateAuthenticatedClient`); the application validates them as it would Keycloak's, only the source of the key is replaced.

Manual check against a running backend (`pnpm dev:infra`, then from `apps/business-backend`: `ASPNETCORE_ENVIRONMENT=Development dotnet run --project src/Elysion.BusinessBackend.Api --no-launch-profile --urls http://localhost:5174`):

```sh
TOKEN=$(curl -s http://localhost:8081/realms/elysion/protocol/openid-connect/token \
  -d grant_type=password -d client_id=elysion-frontend -d username=dev -d password=dev | jq -r .access_token)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5174/health                              # 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5174/boards                              # 401
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" http://localhost:5174/boards   # 200
```

## Users are created from the token (just-in-time)

`UserProvisioningMiddleware` runs after authentication and before authorization, **once per authenticated request**, and puts the caller's local `User` into the scoped `ICurrentUser` (`Id`, `Subject`, `DisplayName`, `Email`). Handlers and policies (#117) take `ICurrentUser`; they do not read claims. Unauthenticated requests and anonymous endpoints (`/health`, the internal document API) are skipped: they never need a user and never write to the database. A valid token without a usable `sub` is `401`.

`UserProvisioningService` does the work, with this claim mapping (Keycloak access token):

| Claim                                                       | Becomes                                                                |
| ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| `sub` (required)                                            | `User.Subject`, the key to the identity provider                       |
| `email` (optional)                                          | `User.Email`                                                           |
| `preferred_username`, else `name`, else `email`, else `sub` | `User.DisplayName`: never blank, whichever optional claims are missing |

A new `sub` inserts a row; a known `sub` is updated only when the email or display name changed (an unchanged token writes nothing). Names and emails longer than the model keeps are cut; a `sub` longer than 255 characters is refused (`401`) instead of being stored cut. **Two first requests of the same person** race on the unique index of `Subject`: `IUserRepository.GetOrAddAsync` inserts, and when the insert fails because the subject exists now it returns the winner's row; there is no check-then-insert. Any other failed insert is not swallowed.

## Board authorization

Resource-based authorization over `BoardMembership` (`Authorization/`). Three named policies, declared by the endpoints with `RequireAuthorization`:

| Policy            | Needs                 | Endpoints                                                                           |
| ----------------- | --------------------- | ----------------------------------------------------------------------------------- |
| `BoardRead`       | Viewer, Editor, Owner | `GET /boards/{id}`, `GET /boards/{id}/membership/me`, `POST /boards/{id}/duplicate` |
| `BoardWrite`      | Editor, Owner         | `PATCH /boards/{id}`                                                                |
| `BoardAdminister` | Owner                 | `DELETE /boards/{id}`                                                               |

`BoardAuthorizationHandler` takes the board id from the route (`{id}`) and the caller from `ICurrentUser`, and compares the caller's role on the board (`IBoardRepository.GetRoleAsync`) with the policy's minimum, by an explicit rank (so reordering the enum cannot change a decision). **The board's owner is an Owner even without a membership row**, so a board is usable before anyone was invited; creating a board (or duplicating one: the copy is the caller's own) makes the caller its owner and adds the explicit Owner membership as well. `GET /boards` returns only boards the caller owns or is a member of.

**A caller with no role on a board gets `404`, not `403`**, and so does a board that does not exist: otherwise anyone could probe ids to learn which boards exist. `BoardAuthorizationResultHandler` turns that one failure into 404; a member whose role is too low (an Editor deleting, a Viewer renaming) gets `403`, a missing token `401`. This is deliberate; do not "fix" it.

`GET /boards/{id}/membership/me` answers `{ boardId, role }` (`Owner`, `Editor` or `Viewer`) for the BFF's WS token check (#120), `404` for non-members.

**Boards from before users existed have no owner** and no membership, so nobody has a role on them: they are invisible (404) and not listed. In a development database give such a board to a user with `UPDATE "Boards" SET "OwnerId" = '<user id>' WHERE "Id" = '<board id>'` (users appear in `"Users"` after their first request). Sharing and invitations are #245.

## Board members

`/boards/{id}/members`, all behind the **administer** policy (an Owner): somebody with a lower role gets `403`, somebody with no role `404`, as for every board endpoint.

| Request                                          | Result                                                                                                                                                                      |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /boards/{id}/members`                       | `200`, `[{ userId, displayName, email, role }]`: the creator first, then in the order roles were given                                                                      |
| `POST /boards/{id}/members` `{ email, role }`    | `201` with the member; `404` if no user has that email; `409` if they are a member already; `400` for a missing email or a `role` that is not `Owner`, `Editor` or `Viewer` |
| `PATCH /boards/{id}/members/{userId}` `{ role }` | `200` with the member; `404` if the user is no member; `409` for the creator and for the last Owner; `400` for a bad role                                                   |
| `DELETE /boards/{id}/members/{userId}`           | `204`; `404` if the user is no member; `409` for the creator and for the last Owner                                                                                         |

- **By email:** only somebody who has logged in to Elysion at least once exists as a user (provisioning, "Users are created from the token"), so an unknown email is `404` with the message that they have to log in first, never a `500`. The email is matched without regard to case; two users with the same email make the invitation `409` ("ambiguous") instead of a guess. A role is read by its name only (`"1"` is refused).
- **The creator** (`Board.OwnerId`) is an Owner whatever a membership row says (`GetRoleAsync`), so their role cannot be changed or removed (`409`): it would have no effect, and pretending it had would be worse. The member list shows the creator as Owner even when no row exists.
- **The last Owner** (the set of Owner memberships plus the creator) cannot be removed or demoted (`409`). With the creator protected this matters for a board without a creator, which nobody can reach through the API today; the rule is in `BoardMemberService` and tested there.
- Changes take effect at once: the next request of a removed or demoted member is evaluated against the new role. A connection that is open keeps its token until the next reconnect (identity.md).

## Repositories

[ADR 0015](../adr/0015-business-backend-repositories.md): the endpoints reach the database through `IBoardRepository` (`ListNewestFirstAsync`, `FindAsync`, `FindForUpdateAsync`, `Add`, `Remove`) and `IBoardDocumentRepository` (`FindAsync`, `SaveAsync`, `Add`, `RemoveAsync`), and commit through `IUnitOfWork` (the scoped `ElysionDbContext`). Repositories hand out untracked copies unless asked for an update, never `IQueryable`. `Add`, `Remove` and `RemoveAsync` stage; the unit of work commits, which makes duplicating a board (a board and a document) and deleting one (the board and its canvas content) single transactions. `IBoardDocumentRepository.SaveAsync` is the versioned save of ADR 0011 and commits itself: `Saved` with the new version, `NotFound` for an update of a missing document, `Conflict` with the stored document when the version moved on, a first save met an existing document, or another writer won the race. The HTTP behavior did not change; the repositories have their own tests (`BoardRepositoryTests`, `BoardDocumentRepositoryTests`) on SQLite, with `DateTimeOffset` stored as a number in the test context because SQLite cannot order by it.

## Guard clauses

Entities are created through factories that guard their invariants with `Ardalis.GuardClauses`: `Board.Create` (name trimmed, 1 to 120 characters, non-empty ids), `User.Create` (subject and display name not blank, lengths within the model's limits, optional email) and `BoardMembership.Create` (non-empty ids, a defined role). A violation throws, and is a programming error; requests are validated before that and answered with `400`, using the same rule (`Board.TryNormalizeName`), so there is one source for each limit.

## Users and memberships (data model)

The model for the identity epic (#91); no endpoint uses it yet.

| Table              | Columns                                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Users`            | `Id` (local key), `Subject` (Keycloak `sub`, **unique**: the join to the identity provider, not the email), `Email` (optional), `DisplayName`, `CreatedAt` |
| `BoardMemberships` | `BoardId`, `UserId`, `Role` (`Owner`, `Editor` or `Viewer`, stored as text), `CreatedAt`; the key is (`BoardId`, `UserId`): one role per user per board    |
| `Boards`           | gains `OwnerId` (the creator, foreign key to `Users`)                                                                                                      |

`Boards.OwnerId` is **nullable**: the boards that exist when the migration runs have no owner, and none can be invented for them. Authorization (#117) decides what an ownerless board means and who becomes its owner. Deleting a user deletes their memberships and leaves their boards ownerless; deleting a board deletes its memberships. The migration `AddUsersAndMemberships` was applied to a development database that held a board: the board stayed, with `OwnerId` null.

## Tests

`dotnet test` runs `tests/Elysion.BusinessBackend.Tests` (NUnit, NSubstitute, Shouldly). They run the real pipeline through `WebApplicationFactory<Program>` with the EF in-memory provider instead of Postgres, so no infrastructure is needed. In-memory is not Postgres: behavior that depends on the provider (ordering, precision, constraints) was checked once against a real database, and anything that starts to depend on SQL should get a test against Postgres. The exception is the users and memberships model (`MembershipModelTests`): unique indexes and foreign keys are not enforced by the in-memory provider, so those tests use SQLite in memory, which is relational.

## Open questions

- REST vs gRPC for internal BFF <-> business-backend calls (packages/proto reserved for this).

## Board documents (internal)

`GET/PUT/DELETE /internal/boards/{boardId}/document` store the Yjs state of a board for the realtime service, one full snapshot per board with a version (ADR 0011; protocol in docs/specs/realtime.md). `boardId` is a string of at most 200 characters (not necessarily a GUID); states up to 32 MB are accepted. The endpoints are minimal APIs in `Endpoints/BoardDocumentEndpoints.cs` and are not routed at the edge.

## Configuration

- `ConnectionStrings:Elysion` — the Postgres connection string.
- `Database:MigrateOnStartup` (default `false`) — when `true`, the app applies pending EF Core migrations at startup. The dev stack's container sets it, because it starts against an empty database; local runs use `dotnet ef database update`.
