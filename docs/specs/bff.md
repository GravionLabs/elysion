# BFF spec (NestJS, TypeScript 6)

## Owner

Backend

## Responsibilities

UI-optimized aggregation of business-backend APIs, Redis caching for heavy UI queries, token exchange for WebSocket handshake. See ADR 0001, ADR 0002.

## Endpoints

Under `/api`, the prefix the gateway routes to the BFF. Backed by the business backend's Board API (`docs/specs/business-backend.md`); the BFF holds no state of its own.

| Request                                                                              | Result                                                    |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `GET /api/boards`                                                                    | `200`, boards newest first                                |
| `GET /api/boards/:id`                                                                | `200` or `404`                                            |
| `POST /api/boards` `{ "name": "..." }`                                               | `201` with the board                                      |
| `PATCH /api/boards/:id` `{ "name": "..." }`                                          | `200` with the renamed board, or `404`                    |
| `POST /api/boards/:id/duplicate`                                                     | `201` with the copy, or `404`                             |
| `DELETE /api/boards/:id`                                                             | `204` or `404`                                            |
| `PUT /api/boards/:id/room` `{ roomId }`                                              | `200` with the board in or out of a room (`roomId: null`) |
| `GET /api/rooms`, `POST /api/rooms`, `PATCH /api/rooms/:id`, `DELETE /api/rooms/:id` | rooms, see Rooms below                                    |

| `GET /api/templates` | `200`, the template catalog without scenes |
| `GET /api/templates/:id` | `200` with the template and its `scene` (the text of an `.excalidraw` file), or `404` |

A board is `{ id, name, createdAt, path }`: the backend's fields plus `path`, the frontend route that opens it (`/board/:id`).

Errors: an id that is not a UUID is a `404` without a call to the backend; a body without a string `name` is a `400`; a name the backend rejects (blank, over 120 characters) stays a `400` with the backend's message; an unknown board stays `404`; an unreachable or failing backend is a `502` (`The business backend is not reachable.`), while `/health` stays up.

JSON bodies up to 6 MB are accepted (`src/http-limits.ts`), so a template's scene gets through; the backend limits the scene itself.

No caching, on purpose (#351): measured through the edge (Traefik, forwardAuth, BFF, business backend, Postgres) on the dev stack, sequential requests with a token, 60 each:

| Boards of the user | `GET /api/boards` p50 / p95 | response | `GET /api/templates` p50 / p95 | `.../membership/me` (floor) p50 / p95 |
| ------------------ | --------------------------- | -------- | ------------------------------ | ------------------------------------- |
| 1                  | 6.6 / 10.6 ms               | 0.2 kB   | 6.0 / 7.3 ms                   | 5.8 / 7.0 ms                          |
| 101                | 5.0 / 5.4 ms                | 16 kB    | 4.5 / 4.9 ms                   | 4.8 / 5.3 ms                          |
| 1001               | 7.4 / 8.2 ms                | 160 kB   | 4.1 / 4.4 ms                   | 4.8 / 5.2 ms                          |

Even with a thousand boards the list costs about 3 ms more than the cheapest authenticated call, which is the fixed price of the edge (forwardAuth plus two hops). A Valkey cache would save part of that 3 ms at the cost of invalidation on every create, rename, delete and membership change (and per-user keys): not worth it. The trigger to revisit: a measured list latency above roughly 100 ms, or a list that needs paging or search (which a cache would not fix either).

## Authentication

Every route needs a Keycloak access token (`Authorization: Bearer ...`; [identity.md](identity.md), [ADR 0014](../adr/0014-keycloak-identity-provider.md)) except `GET /health`, which container health checks call without one (`@Public()`). `src/auth/`:

- `TokenVerifier` (on `jose`) checks signature against the realm's keys, issuer (`OIDC_ISSUER_URL`), audience (`OIDC_AUDIENCE`, `elysion-bff`), expiry (30 s of clock tolerance) and a `sub`; only RS256 is accepted, so a token cannot pick `none` or a weaker algorithm. The keys come from `OIDC_JWKS_URI`, or `<issuer>/protocol/openid-connect/certs`; `jose` caches them and fetches again when a token names an unknown key (rotation). A failure to reach the realm is a server error, not "invalid token". It never calls the business backend.
- `AuthGuard` is global (`APP_GUARD`): no token or an invalid one is `401` with `WWW-Authenticate: Bearer`; on success `request.auth` holds the token and its claims.
- `GET /api/auth/verify` is what Traefik's forwardAuth middleware calls (#8; the open-source Traefik has no JWT middleware): `200` with `X-Auth-User-Id` (`sub`) and `X-Auth-User-Email` (when the token has one), or `401`. Cheap by design: a cached key and a signature check.
- The board routes forward the caller's own token to the business backend (`@AccessToken()`), which decides what the user may do; its `401`, `403` and `404` (no role on a board is a 404 there) are passed on.

In tests the verifier is replaced by one that trusts a locally generated key pair (`test/test-auth.ts`: `signToken`, `bearer`, `testVerifier`); everything else about the check is the production code.

## Role of the caller

`GET /api/boards/:id/membership/me` → `{ boardId, role }` with `role` `owner`, `editor` or `viewer` (`BoardsController.membership`, from the backend's `membership/me`, lower-cased like the WS token's role); `404` without a role, like every board route. The shell uses it to decide what to show (Share for owners, a read-only canvas for viewers); it is a hint for the interface, the backend and the realtime service enforce the rules.

## Board members

`/api/boards/:id/members` (`GET`, `POST { email, role }`, `PATCH :userId { role }`, `DELETE :userId`; `MembersController`) passes on to the business backend's member API with the caller's own token ([business-backend.md](business-backend.md), "Board members"). The BFF only checks the shape: ids that are not UUIDs are `404` and a body without a string `email` or `role` is `400`, both without a call to the backend. The backend's answers come back with its message: `403` (a lower role), `404` (a board the caller cannot see, an unknown email, not a member), `409` (already a member, the creator, the last owner), `400` (a bad role).

## Rooms

Rooms group boards ([ADR 0019](../adr/0019-grouping-boards.md), [business-backend.md](business-backend.md), "Rooms"). `RoomsController` serves `GET /api/rooms` (`[{ id, name, createdAt, role }]`, `role` being the caller's role in the room), `POST /api/rooms { name }` (`201`), `PATCH /api/rooms/:id { name }` and `DELETE /api/rooms/:id` (`204`; the boards of the room stay and leave it); `BoardsController.move` serves `PUT /api/boards/:id/room { roomId | null }`; `RoomMembersController` serves `/api/rooms/:id/members` like the board members. Every board the API returns has `roomId` (`null` outside a room). All of it is passed on with the caller's own token and the backend decides: `404` for a room the caller has no role in (also the answer for a room id that does not exist), `403` for a role that is too low, `400` with the backend's message for a refused name, `409` for the member list's rules, `502` when the backend cannot be reached. The BFF only checks the shape, without a call to the backend: ids that are not UUIDs are `404` (in the route and as `roomId` in the body), a body without a string `name` is `400`, a `roomId` that is neither a string nor `null` is `400`.

## WS tokens

`POST /api/realtime/token` (`src/realtime/`, body `{ "boardId": "<uuid>" }`, answer `{ token, expiresAt }`, [identity.md](identity.md)) mints the board-scoped credential for the realtime service: the caller's role on the board is looked up with their own token (`BusinessBackendClient.getMyRole`, the backend's `membership/me`), no role is `403`, a missing `boardId` is `400`, a backend failure `502`. `WsTokenService` signs HS256 with `WS_TOKEN_SECRET` for `WS_TOKEN_TTL_SECONDS` (60); claims are `sub`, `boardId`, `role`, `iss: elysion-bff`, `aud: elysion-realtime`, `iat`, `exp`, typed by `@elysion/shared-types`. Renewal is the client's business: it asks again on every (re)connect (#312).

## Logging

[ADR 0025](../adr/0025-structured-logging-and-log-viewer.md). `nestjs-pino` with the options of `packages/node-logging` (`@elysion/node-logging`, shared with the realtime service so that both write the same line); `src/logging/logging.module.ts`.

- **Format.** One JSON object per line on stdout (`LOG_FORMAT=json`, the default whenever stdout is not a terminal); readable text through `pino-pretty` in a terminal (`LOG_FORMAT=text`). `LOG_LEVEL` is `trace`, `debug`, `info` (default), `warn`, `error` or `fatal`; both are validated at start like the rest of the configuration.
- **Fields** (the same in the realtime service and the business backend): `timestamp` (ISO 8601, UTC), `level`, `service` (`elysion-bff`), `requestId`, `message`, `userId` (the token's `sub` and nothing else about the person; set by `AuthGuard` once the token is verified, so the final line of the request has it too), `err` (`type`, `message`, `stack`) on an exception, and `context` (the Nest class that logged). The one line per finished request adds `http`: `method`, `route` (the Express route pattern, `/api/boards/:id`; `unmatched` for a URL no route matches), `status`, `durationMs`. `/health` and `/metrics` log that line at `debug`.
- **Request id.** The header is `X-Request-Id`. `genReqId` and `requestIdMiddleware` take the value of the request when it matches `^[A-Za-z0-9._-]{8,64}$` and create a UUID otherwise; it is echoed in the response (and exposed to browsers by the edge's CORS middleware), is on every line of the request, and is the _current request id_ of an `AsyncLocalStorage`, which `BusinessBackendClient` sends on every call to the business backend. A value that does not match is replaced and never logged.
- **Rejected tokens.** `AuthGuard` logs `Access token rejected` at `warn` with `reason` (`expired`, `not_yet_valid`, `wrong_issuer`, `wrong_audience`, `wrong_algorithm`, `invalid_signature`, `malformed`, `missing_claim`, `invalid`), never the token or the library's message.
- **Never logged:** `Authorization`, `Cookie`, `Set-Cookie`, query strings (`/yjs?token=...` is not a BFF route, but the rule is the same everywhere: the line has the route, not the URL), and secrets. The request line carries no headers at all; `redact` covers `authorization`, `cookie`, `token`, `access_token`, `password` and `secret` up to three levels deep for the day somebody logs an object. `test/logging.e2e-spec.ts` sends marker strings in each place and asserts that none reaches the output.
- **Start-up lines** of Nest (module initialisation, mapped routes) come through the same logger at `info`.

## Configuration

Read once at startup by `src/config/` (`@nestjs/config`, validated by `validateEnv`) and used through the typed `AppConfigService` (`config.get('PORT')` is a number); nothing else reads `process.env`. A missing or malformed variable stops the process before it listens, with a message that names every problem. For local runs copy `apps/bff/.env.example` to `apps/bff/.env`; the compose file sets what the container needs.

| Variable                           | Default                                | Meaning                                                                                          |
| ---------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `PORT`                             | `3000`                                 | port of the BFF                                                                                  |
| `BUSINESS_BACKEND_URL`             | `http://localhost:5174`                | the business backend, whose dev port is set in `.vscode/launch.json`                             |
| `OIDC_ISSUER_URL`                  | `http://localhost:8081/realms/elysion` | the `iss` the access tokens carry ([identity.md](identity.md))                                   |
| `OIDC_AUDIENCE`                    | `elysion-bff`                          | the audience an access token must contain                                                        |
| `OIDC_JWKS_URI`                    | none (derived from the issuer)         | where to fetch Keycloak's keys when that is not the issuer's address (inside compose)            |
| `WS_TOKEN_SECRET`                  | **none, required**                     | HS256 secret of the WS token, at least 32 characters, the same as in the realtime service        |
| `WS_TOKEN_TTL_SECONDS`             | `60`                                   | lifetime of a WS token                                                                           |
| `LOG_LEVEL`                        | `info`                                 | `trace`, `debug`, `info`, `warn`, `error` or `fatal` (see "Logging")                             |
| `LOG_FORMAT`                       | none: text in a terminal, else `json`  | `json` or `text`                                                                                 |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | none (off)                             | also send every log line to this OTLP/HTTP logs endpoint, the dev stack's viewer (see "Logging") |
| `OTEL_EXPORTER_OTLP_LOGS_HEADERS`  | none                                   | headers for those requests, `name=value,name2=value2`                                            |

`OIDC_*` are used by the token verifier, `WS_TOKEN_*` by `WsTokenService`.

## Open questions

- REST vs GraphQL for BFF-to-frontend contract.
