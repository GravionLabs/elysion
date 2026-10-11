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

A board is `{ id, name, createdAt, roomId }` (`roomId` is the room it is in, or `null`; see "Rooms"). The name is trimmed and must be 1 to 120 characters; otherwise the answer is `400` with problem details (`errors.name`). A route id that is not a GUID is a `404`. `createdAt` is cut to microseconds, which is what Postgres keeps, so a create and every later read show the same value.

Board access is governed by roles, see "Board authorization" below: the list holds only the boards the caller owns, is a member of, or can reach through a room, and every other board endpoint needs a role on the board.

**Duplicate** creates a board named "&lt;name&gt; (copy)" (the name is cut short, to 120 characters, when the suffix would not fit) and copies the source's stored document byte for byte as a fresh document (version 1), so the two boards are independent from then on. The copy is what was last saved: changes still inside a room's save window (a few seconds) are not in it yet. A board without content gets a copy without a document.

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

## Logging

[ADR 0025](../adr/0025-structured-logging-and-log-viewer.md). Serilog replaces the framework's logger (`Logging/`, `builder.AddElysionLogging()` and `app.UseElysionRequestId()` in `Program.cs`).

- **Format.** One JSON object per line on stdout (`LOG_FORMAT=json`, the default whenever stdout is not a terminal); readable text in a terminal (`LOG_FORMAT=text`). `LOG_LEVEL` is `trace`, `debug`, `info` (default), `warn`, `error` or `fatal`.
- **Fields** (the same in the BFF and the realtime service): `timestamp` (ISO 8601, UTC), `level`, `service` (`elysion-business-backend`), `requestId`, `message`, `userId` (the token's `sub` and nothing else about the person), `err` (`type`, `message`, `stack`) on an exception, and `context` (the category, the same name `nestjs-pino` uses). Other properties of an event follow with camel-case names (`reason`, `scheme`). The one line per finished request adds `http`: `method`, `route` (the route pattern, `/boards/{id}`, never the URL), `status`, `durationMs`; health checks log it at `debug`.
- **Request id.** `RequestIdMiddleware` takes the `X-Request-Id` of the request when it matches `^[A-Za-z0-9._-]{8,64}$` (the BFF sends one) and creates a UUID otherwise; it is echoed in the response and is on every line of the request. A value that does not match is replaced and never logged. The property is `requestId`, not `RequestId`: ASP.NET Core's hosting scope uses that name for its own trace id, which the formatter leaves out.
- **Rejected tokens.** A refused bearer token logs one warning with `reason` (`expired`, `not_yet_valid`, `wrong_issuer`, `wrong_audience`, `wrong_algorithm`, `invalid_signature`, `malformed`, `invalid`) and `scheme`: `Bearer` for a Keycloak token, `Internal` for the realtime service's token on `/internal` (ADR 0017). A request to the internal API without any token logs "No bearer token". The token and the exception's message are never logged.
- **Never logged:** `Authorization`, `Cookie`, query strings (the request line has the route, not the URL), and any configured secret. `LoggingTests` sends marker strings in each and asserts that none reaches the output.
- **The framework's own request lines** (`Microsoft.AspNetCore`, EF Core commands, `HttpClient`) are limited to warnings; the HTTPS-redirect middleware's "no HTTPS port" warning is limited to errors, because the service speaks plain HTTP behind the edge.

## Users are created from the token (just-in-time)

`UserProvisioningMiddleware` runs after authentication and before authorization, **once per authenticated request**, and puts the caller's local `User` into the scoped `ICurrentUser` (`Id`, `Subject`, `DisplayName`, `Email`). Handlers and policies (#117) take `ICurrentUser`; they do not read claims. Unauthenticated requests and anonymous endpoints (`/health`, the internal document API) are skipped: they never need a user and never write to the database. A valid token without a usable `sub` is `401`.

`UserProvisioningService` does the work, with this claim mapping (Keycloak access token):

| Claim                                                       | Becomes                                                                |
| ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| `sub` (required)                                            | `User.Subject`, the key to the identity provider                       |
| `email` (optional)                                          | `User.Email`                                                           |
| `preferred_username`, else `name`, else `email`, else `sub` | `User.DisplayName`: never blank, whichever optional claims are missing |

A new `sub` inserts a row; a known `sub` is updated only when the email or display name changed (an unchanged token writes nothing). Names and emails longer than the model keeps are cut; a `sub` longer than 255 characters is refused (`401`) instead of being stored cut. **Two first requests of the same person** race on the unique index of `Subject`: `IUserRepository.GetOrAddAsync` inserts, and when the insert fails because the subject exists now it returns the winner's row; there is no check-then-insert. Any other failed insert is not swallowed.

**Groups from the token** (ADR 0027, #647): the claim named by `OIDC_GROUPS_CLAIM` (default `groups`; set to an empty value it switches the sync off, and then no token changes a group membership) is read with the rest of the claims. Each value is trimmed; empty values, values over 255 characters (left out, never cut: a cut id would be another group's) and everything after the first 500 (sorted) are ignored. For the values a **linked** group (`Group.Source = IdentityProvider`, `ExternalId` = the value, unique) is found or created, named after its id until an administrator renames it; the person's memberships in linked groups become exactly that set (a token without the claim, with the setting on, means no linked groups). Memberships in **local** groups are never touched. The comparison runs once per person and claim: a hash of the sorted values is remembered per person for an hour (`IMemoryCache`), and a request whose claim has that hash does not call the database for it, so the ordinary request is unchanged. **A membership is therefore as fresh as the person's token, which is as fresh as their last sign-in at the identity provider** (ADR 0027, "Lifecycle"), and a change made in the database by hand is noticed after the hour at the latest or when the instance restarts. Two first requests that create the same group race on the unique index of `ExternalId`; the loser looks again once and uses the winner's row.

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

## Metrics

`GET /metrics` (prometheus-net, no token) is read on the compose network at `http://business-backend:8080/metrics`; nothing routes it at the edge, which forwards `/api` to the BFF only. It serves the process metrics, `http_request_duration_seconds` by method, status and route pattern (never the URL) and `elysion_backend_db_commands_total` by outcome, counted by an EF Core interceptor. The table of all services is in [the gateway spec](gateway.md#logs-and-metrics).

## Rooms

Rooms group boards ([ADR 0019](../adr/0019-grouping-boards.md): shared spaces, as in Mural). `Room` (`Id`, `Name` 1 to 120 characters as for a board, `CreatedAt`, `OwnerId`) and `RoomMembership` (`RoomId`, `UserId`, `Role`, the same `Owner`, `Editor`, `Viewer` as a board's) are in `Entities/`, `Board.RoomId` is nullable, and `IRoomRepository` and `IRoomMembershipRepository` follow the board repositories. A board is in at most one room; boards made outside a room, and every board from before rooms, have `RoomId = null` and behave exactly as before.

| Request                                              | Result                                                                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /rooms`                                         | `200`, `[{ id, name, createdAt, role }]`: the rooms the caller owns or is a member of, by name; `role` is the caller's role in the room |
| `POST /rooms` `{ "name": "..." }`                    | `201` with a `Location` header and the room; the caller is its Owner (creator and an explicit Owner membership); `400` for a bad name   |
| `PATCH /rooms/{id}` `{ "name": "..." }`              | `200` with the room (needs Editor); `400` for a bad name                                                                                |
| `DELETE /rooms/{id}`                                 | `204` (needs Owner); the room and its memberships go, **its boards stay** and leave the room (`RoomId` becomes null)                    |
| `PUT /boards/{id}/room` `{ "roomId": guid \| null }` | `200` with the board: puts it in a room, or takes it out with `null`                                                                    |
| `/rooms/{id}/members` (list, add, change, remove)    | The rules of the board member API ("Board members"), behind the Owner policy of the room; the messages say "room"                       |

A caller with **no role in a room gets `404`, not `403`**, for the same reason as for boards (room ids cannot be probed); a role that is too low is `403`. `RoomPolicies` (`RoomRead`, `RoomWrite`, `RoomAdminister`) and `RoomAuthorizationHandler` mirror the board policies and reuse `BoardPolicies.Rank`. **Moving a board** needs `BoardWrite` on the board (the policy) and Editor in the target room; a room the caller has no role in is `404` ("The room does not exist."), a Viewer there `403`, a body without `roomId` `400`. Taking a board out of a room needs `BoardWrite` only.

**What a room adds to access** (`BoardRepository.GetRoleAsync`, `ListVisibleToAsync`): a room's role **adds** to a board's own; the higher of the two wins. A member of the room has the room's role on every board in it, the room's creator is an Owner of the room without a membership row, and the board's own members and owner keep their roles when the board leaves the room. `GET /boards` returns the boards the caller owns, is a member of, or that are in one of their rooms, each once. `GET /boards/{id}/membership/me` answers with the effective role, so the BFF's WS token check and the realtime service need no change. A board's creator stays its Owner whoever else has a role through the room, and creating a board is still outside any room (move it with `PUT /boards/{id}/room`).

**Groups on rooms** (ADR 0027, #647): `Group` (`Id`, `Name`, `ExternalId?`, `Source` `Local` or `IdentityProvider`, `CreatedAt`), `GroupMembership` (`GroupId`, `UserId`) and `RoomGroupMembership` (`RoomId`, `GroupId`, `Role`) are in `Entities/`; deleting a group removes its memberships and its room roles, deleting a room or a user removes their rows (cascade). A group's role in a room counts like a room membership of each of its members: the effective role on a room and on its boards is the **highest** of the board role, the room role and the roles of the caller's groups in the room (`BoardRepository.GetRoleAsync`, `ListVisibleToAsync`, `RoomRepository.GetRoleAsync`, `ListVisibleToAsync`: one query each, the groups are a subquery, no per-group call). `GET /boards/{id}/membership/me` still answers one role, so the BFF's WS token and the realtime service did not change; no role still means `404`.

| Request                                                   | Result                                                                                                                                                                |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /groups?query=`                                      | `200`, `[{ id, name, source }]`: groups whose name contains the text (ignoring case), by name, at most 20; `400` under 2 characters; any signed-in person; no members |
| `GET /me/groups`                                          | `200`, the caller's groups                                                                                                                                            |
| `GET /rooms/{id}/groups`                                  | `200`, `[{ groupId, name, role }]` (needs room read)                                                                                                                  |
| `PUT /rooms/{id}/groups/{groupId}` `{ "role": "Viewer" }` | `200` with the entry (needs room Owner): gives the group a role or changes it; `404` for an unknown group, `400` for a bad role                                       |
| `DELETE /rooms/{id}/groups/{groupId}`                     | `204` (needs room Owner); `404` when the group has no role in the room                                                                                                |

The room's people (`/rooms/{id}/members`) are unchanged; making, linking, renaming and deleting groups and local group members are for administrators (#655).

**Deleting a room** does not delete boards: the endpoint takes its boards out first (so the in-memory test provider and the tracked entities agree with Postgres, whose foreign key sets `RoomId` to null as well), then removes the room; the memberships go with it (cascade).

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

## Board files (images)

The files of a board (the images drawn on it) are kept in an S3-compatible object store, never in the shared document (#702): the document holds a reference, `{ fileId, mimeType, created }`, and the bytes live under the key `boards/{boardId}/{fileId}`. `fileId` is the id Excalidraw gives a file, a hash of its content, so the same image is stored once per board.

| Request                           | Result                                                                                                                                                                                                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUT /boards/{id}/files/{fileId}` | `204`; needs the board's write role. The body is the file, `Content-Type` one of `image/png`, `image/jpeg`, `image/gif`, `image/webp`. `415` for another type, `400` for bytes that are not that image, `413` over `MAX_FILE_BYTES`, `409` when the board holds `MAX_FILES_PER_BOARD` files |
| `GET /boards/{id}/files/{fileId}` | `200` with the bytes (`Cache-Control: private, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`, a sandboxing CSP) or `404`; needs the read role                                                                                                                             |

The type is checked by the first bytes, not by the header alone. **SVG is refused:** it is a document that can carry script, and the canvas draws the four raster formats. The upload is read into memory up to the limit (10 MiB by default) before it goes to the store, so that the bytes can be checked and the SDK can sign a payload of known length; the BFF in front streams. Deleting a board deletes every object under its prefix, duplicating one copies the prefix (the copy's document refers to the same ids). Endpoints: `Endpoints/BoardFileEndpoints.cs`; the store: `Files/` (`IFileStore`, `S3FileStore` with path-style addressing, `InMemoryFileStore` for the tests).

At start the service creates the bucket if it is missing and checks that it can list it, retrying for 30 seconds because the store may start after the service; it does not start without a store (a wrong endpoint or key is found at start, not on the first upload). `S3FileStoreTests` runs the real client against a store when `ELYSION_TEST_S3_ENDPOINT` is set (RustFS of `pnpm dev:infra` is `http://localhost:9100`).

## Configuration

- `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` (required), `S3_BUCKET` (default `elysion-files`) — the object store of board files. `MAX_FILE_BYTES` (default 10485760) and `MAX_FILES_PER_BOARD` (default 200) — the limits. The dev stack's values are in `docker-compose.yml` and `appsettings.Development.json`.
- `ConnectionStrings:Elysion` — the Postgres connection string.
- `Database:MigrateOnStartup` (default `false`) — when `true`, the app applies pending EF Core migrations at startup. The dev stack's container sets it, because it starts against an empty database; local runs use `dotnet ef database update`.
- `--migrate` (command-line argument) — applies the pending migrations and exits without serving. The Helm chart runs it as a hook job before an install or upgrade (`migrateJob.enabled`), so that replicas never migrate at the same time; the replicas then keep `MigrateOnStartup` off.

## Quotas

What one person may keep is limited (finding F6 of the [security review](../security.md), #777), so that one account cannot store boards and templates until the database is full. A request over a quota is answered **`409`** with a problem (`Template quota reached`, `Board quota reached`) that says what to delete. `MAX_TEMPLATES_PER_USER` (100 templates of their own), `MAX_TEMPLATE_CHARACTERS_PER_USER` (20,000,000 characters of scenes together; one scene is at most 5,000,000) and `MAX_BOARDS_PER_USER` (1,000 boards they own; a copy of a board counts, boards shared with them do not). Compose, `.env.example` and the chart's `quotas.*` set them; the built-in templates never count. Rooms have no quota yet.

## Invitation links

Share a board or a room with a link (#734). `Invitation` has a SHA-256 of the token (`TokenHash`, unique), exactly one of `BoardId` and `RoomId` (a check constraint), the `Role` (Editor or Viewer, never Owner), `ExpiresAt`, an optional `MaxUses`, `Uses`, who made it and `RevokedAt`; it goes with its board or room. The token is 32 random bytes as base64url (43 characters), returned **once**, in the answer to its creation, and never stored or logged (a log line has the route pattern `/invitations/{token}/accept`, never the URL).

| Call                                                                                                                           | Policy               | Result                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /boards/{id}/invitations`, `POST /rooms/{id}/invitations` with `{role, expiresInHours (1 to 720), maxUses? (1 to 1000)}` | Administer           | `201` with `{id, token, url: null, role, expiresAt, maxUses, uses, createdAt}`; `400` for a role other than Editor or Viewer or a limit outside its range; `409` when the target has 50 active links     |
| `GET .../invitations`                                                                                                          | Administer           | `200` the active links (not revoked, not expired, not used up), oldest first, without the token                                                                                                          |
| `DELETE .../invitations/{invitationId}`                                                                                        | Administer           | `204`, also a second time; `404` for a link of another board or room                                                                                                                                     |
| `POST /invitations/{token}/accept`                                                                                             | any signed-in person | `200` with `{kind: "board" or "room", id, role}`, the role the person has now; `404` for a token that does not exist (also one that cannot be a token), `410` when it expired, was revoked or is used up |

Following a link adds the person's own membership with the link's role, or raises their own membership; it never lowers a role. A person who has that role or a higher one already (through their own row, through a room, or as the creator) is told their role and nothing changes. **A use is counted only when a membership was added or raised**, so a link is not spent by people who did not need it. `Uses` is a concurrency token: two people taking the last use at the same moment cannot both get it (the second looks again and gets `410`). A link never makes an Owner; an Owner adds Owners through the member API.

## What a person keeps about a board

Search, last opened and favorites (#730, [ADR 0019](../adr/0019-grouping-boards.md) option E). Two tables keyed by board and user, both cascading with the board: `BoardVisits` (`LastOpenedAt`) and `BoardFavorites` (`CreatedAt`). `POST /boards/{id}/open` (read role) records a visit and answers `204`; it writes at most once every five minutes per board and person (`BoardUserStateRepositoryDefaults.VisitInterval`), so reopening a board costs no write. `PUT` and `DELETE /boards/{id}/favorite` (read role, idempotent, `204`) set and remove the star. Nobody else sees either: they say nothing the board itself holds, so a viewer may have them. `GET /boards` and `GET /boards/{id}` carry `lastOpenedAt` and `isFavorite` for the caller. `GET /boards?query=` keeps the boards whose name contains the text, ignoring case (a blank value is no search).

## Dot voting

The votes of a board live here, not in its Yjs document ([ADR 0029](../adr/0029-dot-voting-on-the-server.md), #732). `VotingSession` (name, `VotesPerPerson`, `Status` open/closed, `Named`, the starter's subject and name, `StartedAt`, `ClosedAt`) and `Vote` (session, user, `ElementId` up to 128 characters, `CreatedAt`); both cascade with the board, and a partial unique index (`Status = 0`) allows one open session per board even when two starts race (`409`). Closed sessions stay until someone clears them.

| Call                                                          | Policy | Answer                                                                                                                       |
| ------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `GET /boards/{id}/voting`                                     | read   | `200` the open voting, else the one closed last, as the caller sees it; `204` when the board has none                        |
| `POST /boards/{id}/votings` `{name?, votesPerPerson, named?}` | write  | `201`; `400` for votes outside 1 to 100 or a name over 80 characters; `409` while one is open                                |
| `POST /boards/{id}/votings/{votingId}/votes` `{elementId}`    | read   | `200` the voting; `409` when the voting is closed or the person has no vote left; `400` for an empty or over-long element id |
| `DELETE /boards/{id}/votings/{votingId}/votes/{elementId}`    | read   | `200` after taking back the caller's latest vote on that element; `204` when they had none; `409` when closed                |
| `POST /boards/{id}/votings/{votingId}/close`                  | write  | `200` with the result; closing a closed voting is a `200` that changes nothing                                               |
| `DELETE /boards/{id}/votings`                                 | write  | `204`; removes the closed votings, an open one stays                                                                         |

Viewers vote (the read policy); a voting of another board is a `404`. **What the caller sees** (`VotingDto`): the fields of the voting, their own votes (`myVotes`, `myElementVotes`) and nobody else's targets. While it is open `placed` says how many votes each person (by identity-provider subject) has placed, not on what; once closed `result` has the count per element and, only when the voting was `named`, the voters. **The news** (`IVotingNotifier`, `HttpVotingNotifier`): after each start, vote, retract, close (not a repeated one) and clear the backend posts `{ event, voting }` (the `VotingBroadcastDto`: everything but the caller's own votes, `null` after a clear that leaves none) to `{REALTIME_URL}/internal/boards/{boardId}/voting` with an HS256 token of one minute (issuer `elysion-business-backend`, audience `elysion-realtime`, signed with `INTERNAL_API_SECRET`). A missing `REALTIME_URL` is logged once and nothing is sent; a refusal or an unreachable service is logged, never fails the request (a client fetches the voting when it connects). A person's votes are counted per request, not under a lock: two simultaneous requests of one person at the limit may place one vote more.

## Board thumbnails

The picture on a board's card (#729). `PUT /boards/{id}/thumbnail` (the board's write role) takes a PNG of at most 512 KiB (`415` for another type, `400` for bytes that are no PNG, `413` over the limit), keeps it in the object store under `thumbnails/{boardId}.png` (outside the board's file prefix on purpose: the files of a board are counted and copied by that prefix) and sets `Board.ThumbnailUpdatedAt`, the version of the picture. `GET /boards/{id}/thumbnail` (the read role) answers the PNG with an `ETag` made of that timestamp (`304` for a browser that has it, without reading the store), `private, no-cache`, `nosniff` and a sandboxing CSP, or `404` when there is none. The board list and a board carry `thumbnailUpdatedAt` and `hasThumbnail`. Duplicating a board copies the picture; deleting a board deletes it.
