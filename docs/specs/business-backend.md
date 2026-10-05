# Business backend spec (.NET 10)

## Owner

Backend

## Responsibilities

Domain logic, persistence (PostgreSQL), templates, export service (PNG/PDF). Internal-only, exposed via gateway/BFF. See ADR 0003.

## Services (draft)

- Auth service (JWT/OIDC issuance/validation)
- Board service (CRUD)
- Template service
- Export service

## Board API

The board endpoints (`/boards`, minimal APIs in `Endpoints/BoardEndpoints.cs`) are the Board service. It returns and accepts DTOs (`Contracts/BoardContracts.cs`); the `Board` entity is never exposed. Reached through the BFF only.

| Request                                  | Result                                       |
| ---------------------------------------- | -------------------------------------------- |
| `POST /boards` `{ "name": "..." }`       | `201` with a `Location` header and the board |
| `GET /boards`                            | `200`, all boards, newest first              |
| `GET /boards/{id}`                       | `200` or `404`                               |
| `PATCH /boards/{id}` `{ "name": "..." }` | `200` with the renamed board, or `404`       |
| `DELETE /boards/{id}`                    | `204` or `404`                               |

A board is `{ id, name, createdAt }`. The name is trimmed and must be 1 to 120 characters; otherwise the answer is `400` with problem details (`errors.name`). A route id that is not a GUID is a `404`. `createdAt` is cut to microseconds, which is what Postgres keeps, so a create and every later read show the same value.

There is no owner and no authorization yet: every caller sees every board. Users, board membership and policies come with the identity epic (#91). Duplicating a board is not part of this API because the content lives in the Yjs document of the realtime service, not in Postgres.

## Tests

`dotnet test` runs `tests/Elysion.BusinessBackend.Tests` (NUnit, NSubstitute, Shouldly). They run the real pipeline through `WebApplicationFactory<Program>` with the EF in-memory provider instead of Postgres, so no infrastructure is needed. In-memory is not Postgres: behavior that depends on the provider (ordering, precision, constraints) was checked once against a real database, and anything that starts to depend on SQL should get a test against Postgres.

## Open questions

- REST vs gRPC for internal BFF <-> business-backend calls (packages/proto reserved for this).

## Board documents (internal)

`GET/PUT/DELETE /internal/boards/{boardId}/document` store the Yjs state of a board for the realtime service, one full snapshot per board with a version (ADR 0011; protocol in docs/specs/realtime.md). `boardId` is a string of at most 200 characters (not necessarily a GUID); states up to 32 MB are accepted. The endpoints are minimal APIs in `Endpoints/BoardDocumentEndpoints.cs` and are not routed at the edge.

## Configuration

- `ConnectionStrings:Elysion` — the Postgres connection string.
- `Database:MigrateOnStartup` (default `false`) — when `true`, the app applies pending EF Core migrations at startup. The dev stack's container sets it, because it starts against an empty database; local runs use `dotnet ef database update`.
