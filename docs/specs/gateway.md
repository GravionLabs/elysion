# Gateway spec

## Owner

Infra

## Responsibilities

TLS termination, OIDC/JWT auth validation (provider: Keycloak, ADR 0014), CORS, rate limiting, routing, observability. See ADR 0001.

## Routes

| Path        | Target                        | Notes                                                                                |
| ----------- | ----------------------------- | ------------------------------------------------------------------------------------ |
| `/api/*`    | BFF                           | **authenticated at the edge**: `forwardAuth` to the BFF's `GET /api/auth/verify`     |
| `/yjs`      | Realtime backend (WebSocket)  | not forwardAuth'd: the WS token in the URL is checked by the realtime service itself |
| `/internal` | none (business backend)       | internal only: not routed at the edge; the BFF calls `http://business-backend:8080`  |
| `/`         | Frontend (nginx, Angular app) | lowest priority: every more specific route wins                                      |

The canvas builds its WebSocket URL from the page's host (`/yjs`), and `YjsGateway` listens on `path: '/yjs'`, so
no path rewriting is needed. Traefik passes WebSocket upgrades through natively. Earlier drafts named the
realtime route `/realtime/*`; the service never used it.

## Edge authentication

Traefik's open-source edition has no JWT middleware, so the `/api` router has a `forwardAuth` middleware (`bff-auth@file`, defined in `infra/traefik/dynamic/middlewares.yml`, loaded by the file provider of `traefik.yml`; the router refers to it with a label). For every `/api` request Traefik first calls `http://bff:3000/api/auth/verify` with the request's headers (so with its `Authorization: Bearer ...`): a `2xx` lets the request through, anything else, normally `401` with `WWW-Authenticate: Bearer`, is returned to the caller as it is and the BFF never sees the request. `authResponseHeaders` copies `X-Auth-User-Id` and `X-Auth-User-Email` from the verify answer onto the request that goes on; Traefik removes a header of that name the caller sent first, so an identity cannot be spoofed. The BFF still verifies the token itself (defense in depth: it does not trust that the edge did).

- **Public on purpose:** `/` (the Angular app has to load to start the login) and `/yjs`. A browser WebSocket cannot send an `Authorization` header, so `/yjs` is protected by the board-scoped WS token in its URL, which the realtime service verifies at the handshake ([identity.md](identity.md)); forwardAuth would only reject it. WebSocket upgrades pass through Traefik natively; a check of the dev stack connects two clients through the edge and syncs.
- **Not routed:** `/internal` (the business backend is reachable only on the compose network).
- **Out of scope here:** TLS, rate limiting and CORS (#9), observability (#10). Note for CORS: a browser preflight (`OPTIONS`) carries no token, so #9 has to answer it before this middleware or exempt it.
- **Changing it:** the dynamic file is watched, so an edit applies without restarting Traefik (check the middleware under `http://localhost:8080/dashboard/` or `http://localhost:8080/api/http/middlewares`). A wrong `address` turns every `/api` request into the answer of that address, which is also a quick way to see that the middleware is in the path.

In the dev stack (`pnpm dev:stack`) the routes are Docker labels in `infra/docker/docker-compose.yml`; Traefik
routes over the `elysion_elysion` network because some services also join `local-infra`.

## Open questions

- Authentication: the identity provider is Keycloak and services only validate tokens ([ADR 0014](../adr/0014-keycloak-identity-provider.md)); how the edge enforces it (forwardAuth to the BFF, since Traefik OSS has no JWT middleware) is in [identity.md](identity.md), implemented in #121 (see "Edge authentication").
- Final choice between Traefik-only vs. dedicated API gateway (Kong/APIM) for production.
