# Gateway spec

## Owner

Infra

## Responsibilities

TLS termination, OIDC/JWT auth validation (provider: Keycloak, ADR 0014), CORS, rate limiting, routing, observability. See ADR 0001.

## Routes

| Path        | Target                        | Middlewares (in order)           | Notes                                                                                |
| ----------- | ----------------------------- | -------------------------------- | ------------------------------------------------------------------------------------ |
| `/api/*`    | BFF                           | `cors`, `rate-limit`, `bff-auth` | **authenticated at the edge**: `forwardAuth` to the BFF's `GET /api/auth/verify`     |
| `/yjs`      | Realtime backend (WebSocket)  | `cors`                           | not forwardAuth'd: the WS token in the URL is checked by the realtime service itself |
| `/internal` | none (business backend)       | none                             | internal only: not routed at the edge; the BFF calls `http://business-backend:8080`  |
| `/`         | Frontend (nginx, Angular app) | none                             | lowest priority: every more specific route wins                                      |

The canvas builds its WebSocket URL from the page's host (`/yjs`), and `YjsGateway` listens on `path: '/yjs'`, so
no path rewriting is needed. Traefik passes WebSocket upgrades through natively. Earlier drafts named the
realtime route `/realtime/*`; the service never used it.

## Edge authentication

Traefik's open-source edition has no JWT middleware, so the `/api` router has a `forwardAuth` middleware (`bff-auth@file`, defined in `infra/traefik/dynamic/middlewares.yml`, loaded by the file provider of `traefik.yml`; the router refers to it with a label). For every `/api` request Traefik first calls `http://bff:3000/api/auth/verify` with the request's headers (so with its `Authorization: Bearer ...`): a `2xx` lets the request through, anything else, normally `401` with `WWW-Authenticate: Bearer`, is returned to the caller as it is and the BFF never sees the request. `authResponseHeaders` copies `X-Auth-User-Id` and `X-Auth-User-Email` from the verify answer onto the request that goes on; Traefik removes a header of that name the caller sent first, so an identity cannot be spoofed. The BFF still verifies the token itself (defense in depth: it does not trust that the edge did).

- **Public on purpose:** `/` (the Angular app has to load to start the login) and `/yjs`. A browser WebSocket cannot send an `Authorization` header, so `/yjs` is protected by the board-scoped WS token in its URL, which the realtime service verifies at the handshake ([identity.md](identity.md)); forwardAuth would only reject it. WebSocket upgrades pass through Traefik natively; a check of the dev stack connects two clients through the edge and syncs.
- **Not routed:** `/internal` (the business backend is reachable only on the compose network).
- **Out of scope here:** TLS, observability (#10). CORS and the rate limit are in front of this middleware, see "CORS and rate limiting".
- **Changing it:** the dynamic file is watched, so an edit applies without restarting Traefik (check the middleware under `http://localhost:8080/dashboard/` or `http://localhost:8080/api/http/middlewares`). A wrong `address` turns every `/api` request into the answer of that address, which is also a quick way to see that the middleware is in the path.

## CORS and rate limiting

Two middlewares in front of the routes (#344). They are defined by labels on the `bff` service in `infra/docker/docker-compose.yml` and not in the dynamic file: the file provider cannot read the environment, and the allowed origins and the limit are compose variables.

- **`cors`** (headers middleware; `/api` and `/yjs`): the origins in `CORS_ALLOWED_ORIGINS` (comma-separated; default `http://localhost,http://localhost:4200`) get `Access-Control-Allow-Origin` and may use `GET, POST, PATCH, PUT, DELETE, OPTIONS` with the headers `Authorization` and `Content-Type` (preflight cached for 10 minutes). Any other origin gets no `Access-Control-Allow-Origin`, so its browser refuses the answer; the request itself is still handled (CORS is a browser rule, not authentication, which is `bff-auth`). No credentials: the API takes bearer tokens, no cookies. The Angular app is served from the same origin as the API and needs none of this; it is for another front end or a dev server on another port. A preflight carries no token, so `cors` is first in the chain and answers it itself; it never reaches `bff-auth`.
- **`rate-limit`** (`/api` only): `RATE_LIMIT_AVERAGE` requests per second (default 50) and client address, with a burst of `RATE_LIMIT_BURST` (default 100); over it Traefik answers `429` and the BFF never sees the request. It sits before `bff-auth` so that an unauthenticated flood does not turn into a flood of verify calls. Clients behind one NAT share a budget. `/yjs` has no rate limit: it would count connects, not messages, and a reconnecting canvas must not lock itself out; limiting connects can follow if they turn out to be abused.

Check it (dev stack running):

```sh
# an allowed origin gets the headers, also for a preflight (200, no token needed)
curl -si -X OPTIONS http://localhost/api/boards -H 'Origin: http://localhost:4200' \
  -H 'Access-Control-Request-Method: POST' | grep -i '^access-control'
# a disallowed origin gets no Access-Control-Allow-Origin
curl -si http://localhost/api/boards -H 'Origin: http://evil.example' | grep -i '^access-control'
# a burst over the limit: some answers are 429 (401 is the normal answer without a token)
for i in $(seq 1 200); do curl -s -o /dev/null -w '%{http_code}\n' http://localhost/api/boards; done | sort | uniq -c
```

## Logs and metrics

Which scraper or dashboards run is not decided here; this is what the services provide (#347).

- **Access logs** (Traefik, `accessLog` in `infra/traefik/traefik.yml`): one JSON object per request on stdout (`docker logs elysion-traefik-1`), with the client address, method, router and service, status, size and duration. **Redacted on purpose:** `RequestPath` is dropped, because Traefik writes it with the query string and the `/yjs` URL carries the WS token there (`?board=...&token=...`); the route is still known from `RouterName`. Request headers (`Authorization`, `Cookie`) are not logged either. Application logs (BFF, realtime, business backend) go to stdout of their containers as before.
- **Metrics**, Prometheus text format, all on the compose network only (nothing is published to the host, and `/metrics` is not routed at the edge):

| Service  | URL                            | What                                                                                                                                                                                                 |
| -------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Traefik  | `http://traefik:8082/metrics`  | own entry point `metrics` (`:8082`); requests, durations and open connections per entry point, router and service (`traefik_router_requests_total`, `traefik_service_request_duration_seconds`, ...) |
| BFF      | `http://bff:3000/metrics`      | process metrics, `elysion_bff_http_requests_total` and `elysion_bff_http_request_duration_seconds` by method, route pattern and status (also the requests the auth guard refuses)                    |
| Realtime | `http://realtime:3000/metrics` | process metrics, `elysion_realtime_websocket_connections` (admitted connections), `elysion_realtime_rooms` (boards held in memory)                                                                   |

The BFF's route label is the route pattern (`/api/boards/:id`), never the URL, so ids and query strings cannot become label values; URLs no route matches share the label `unmatched`. The business backend has no metrics endpoint yet.

In the dev stack (`pnpm dev:stack`) the routes are Docker labels in `infra/docker/docker-compose.yml`; Traefik
routes over the `elysion_elysion` network because some services also join `local-infra`.

## Open questions

- Authentication: the identity provider is Keycloak and services only validate tokens ([ADR 0014](../adr/0014-keycloak-identity-provider.md)); how the edge enforces it (forwardAuth to the BFF, since Traefik OSS has no JWT middleware) is in [identity.md](identity.md), implemented in #121 (see "Edge authentication").
- Final choice between Traefik-only vs. dedicated API gateway (Kong/APIM) for production.
