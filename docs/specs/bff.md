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

A board is `{ id, name, createdAt, path }`: the backend's fields plus `path`, the frontend route that opens it (`/board/:id`).

Errors: an id that is not a UUID is a `404` without a call to the backend; a body without a string `name` is a `400`; a name the backend rejects (blank, over 120 characters) stays a `400` with the backend's message; an unknown board stays `404`; an unreachable or failing backend is a `502` (`The business backend is not reachable.`), while `/health` stays up.

No authentication yet (#119) and no caching. Identity comes from Keycloak (see [ADR 0014](../adr/0014-keycloak-identity-provider.md)); the BFF will only validate its tokens.

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

The auth variables are only declared so far: nothing validates a token or issues a WS token yet (#119, #120).

## Open questions

- REST vs GraphQL for BFF-to-frontend contract.
