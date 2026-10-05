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
| `DELETE /api/boards/:id`                    | `204` or `404`                         |

A board is `{ id, name, createdAt, path }`: the backend's fields plus `path`, the frontend route that opens it (`/board/:id`).

Errors: an id that is not a UUID is a `404` without a call to the backend; a body without a string `name` is a `400`; a name the backend rejects (blank, over 120 characters) stays a `400` with the backend's message; an unknown board stays `404`; an unreachable or failing backend is a `502` (`The business backend is not reachable.`), while `/health` stays up.

No authentication yet (#119) and no caching.

## Configuration

| Variable | Default | |
| --- | --- |
| `PORT` | `3000` | port of the BFF |
| `BUSINESS_BACKEND_URL` | `http://localhost:5174` | the business backend, whose dev port is set in `.vscode/launch.json` |

Read directly from the environment for now; a config module with validation is #118.

## Open questions

- REST vs GraphQL for BFF-to-frontend contract.
