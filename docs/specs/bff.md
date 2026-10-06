# BFF spec (NestJS, TypeScript 6)

## Owner

Backend

## Responsibilities

UI-optimized aggregation of business-backend APIs, Redis caching for heavy UI queries, token exchange for WebSocket handshake. See ADR 0001, ADR 0002.

## Endpoints

Under `/api`, the prefix the gateway routes to the BFF. Backed by the business backend's Board API (`docs/specs/business-backend.md`); the BFF holds no state of its own.

| Request                                     | Result                                 |
| ------------------------------------------- | -------------------------------------- |
| `GET /api/boards`                           | `200`, boards newest first             |
| `GET /api/boards/:id`                       | `200` or `404`                         |
| `POST /api/boards` `{ "name": "..." }`      | `201` with the board                   |
| `PATCH /api/boards/:id` `{ "name": "..." }` | `200` with the renamed board, or `404` |
| `POST /api/boards/:id/duplicate`            | `201` with the copy, or `404`          |
| `DELETE /api/boards/:id`                    | `204` or `404`                         |

| `GET /api/templates` | `200`, the template catalog without scenes |
| `GET /api/templates/:id` | `200` with the template and its `scene` (the text of an `.excalidraw` file), or `404` |

A board is `{ id, name, createdAt, path }`: the backend's fields plus `path`, the frontend route that opens it (`/board/:id`).

Errors: an id that is not a UUID is a `404` without a call to the backend; a body without a string `name` is a `400`; a name the backend rejects (blank, over 120 characters) stays a `400` with the backend's message; an unknown board stays `404`; an unreachable or failing backend is a `502` (`The business backend is not reachable.`), while `/health` stays up.

JSON bodies up to 6 MB are accepted (`src/http-limits.ts`), so a template's scene gets through; the backend limits the scene itself.

No caching.

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

## WS tokens

`POST /api/realtime/token` (`src/realtime/`, body `{ "boardId": "<uuid>" }`, answer `{ token, expiresAt }`, [identity.md](identity.md)) mints the board-scoped credential for the realtime service: the caller's role on the board is looked up with their own token (`BusinessBackendClient.getMyRole`, the backend's `membership/me`), no role is `403`, a missing `boardId` is `400`, a backend failure `502`. `WsTokenService` signs HS256 with `WS_TOKEN_SECRET` for `WS_TOKEN_TTL_SECONDS` (60); claims are `sub`, `boardId`, `role`, `iss: elysion-bff`, `aud: elysion-realtime`, `iat`, `exp`, typed by `@elysion/shared-types`. Renewal is the client's business: it asks again on every (re)connect (#312).

## Configuration

Read once at startup by `src/config/` (`@nestjs/config`, validated by `validateEnv`) and used through the typed `AppConfigService` (`config.get('PORT')` is a number); nothing else reads `process.env`. A missing or malformed variable stops the process before it listens, with a message that names every problem. For local runs copy `apps/bff/.env.example` to `apps/bff/.env`; the compose file sets what the container needs.

| Variable               | Default                                | Meaning                                                                                   |
| ---------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------- |
| `PORT`                 | `3000`                                 | port of the BFF                                                                           |
| `BUSINESS_BACKEND_URL` | `http://localhost:5174`                | the business backend, whose dev port is set in `.vscode/launch.json`                      |
| `OIDC_ISSUER_URL`      | `http://localhost:8081/realms/elysion` | the `iss` the access tokens carry ([identity.md](identity.md))                            |
| `OIDC_AUDIENCE`        | `elysion-bff`                          | the audience an access token must contain                                                 |
| `OIDC_JWKS_URI`        | none (derived from the issuer)         | where to fetch Keycloak's keys when that is not the issuer's address (inside compose)     |
| `WS_TOKEN_SECRET`      | **none, required**                     | HS256 secret of the WS token, at least 32 characters, the same as in the realtime service |
| `WS_TOKEN_TTL_SECONDS` | `60`                                   | lifetime of a WS token                                                                    |

`OIDC_*` are used by the token verifier, `WS_TOKEN_*` by `WsTokenService`.

## Open questions

- REST vs GraphQL for BFF-to-frontend contract.
