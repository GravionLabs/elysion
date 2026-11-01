# Gateway spec

## Owner

Infra

## Responsibilities

TLS termination, OIDC/JWT auth validation (provider: Keycloak, ADR 0014), CORS, rate limiting, routing, observability. See ADR 0001.

## Routes

| Path              | Target                                   | Middlewares (in order)                               | Notes                                                                                |
| ----------------- | ---------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `/api/csp-report` | BFF                                      | `security-headers`, `rate-limit`                     | a browser's CSP violation report: no token, so no `bff-auth`; the longer rule wins   |
| `/api/*`          | BFF                                      | `security-headers`, `cors`, `rate-limit`, `bff-auth` | **authenticated at the edge**: `forwardAuth` to the BFF's `GET /api/auth/verify`     |
| `/yjs`            | Realtime backend (WebSocket)             | `security-headers`, `cors`                           | not forwardAuth'd: the WS token in the URL is checked by the realtime service itself |
| `/internal`       | none (business backend)                  | none                                                 | internal only: not routed at the edge; the BFF calls `http://business-backend:8080`  |
| `/`               | Frontend (nginx, Angular app, port 8080) | none                                                 | lowest priority: every more specific route wins                                      |

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

Two middlewares in front of the routes (#344). They are defined by labels on the `bff` service in `docker-compose.yml` and not in the dynamic file: the file provider cannot read the environment, and the allowed origins and the limit are compose variables.

- **`cors`** (headers middleware; `/api` and `/yjs`): the origins in `CORS_ALLOWED_ORIGINS` (comma-separated; default `http://localhost,http://localhost:4200`) get `Access-Control-Allow-Origin` and may use `GET, POST, PATCH, PUT, DELETE, OPTIONS` with the headers `Authorization` and `Content-Type` (preflight cached for 10 minutes); a script may read the response header `X-Request-Id` (`Access-Control-Expose-Headers`, [ADR 0025](../adr/0025-structured-logging-and-log-viewer.md)). Any other origin gets no `Access-Control-Allow-Origin`, so its browser refuses the answer; the request itself is still handled (CORS is a browser rule, not authentication, which is `bff-auth`). No credentials: the API takes bearer tokens, no cookies. The Angular app is served from the same origin as the API and needs none of this; it is for another front end or a dev server on another port. A preflight carries no token, so `cors` is first in the chain and answers it itself; it never reaches `bff-auth`.
- **`rate-limit`** (`/api` only): `RATE_LIMIT_AVERAGE` requests per second (default 50) and client address, with a burst of `RATE_LIMIT_BURST` (default 100); over it Traefik answers `429` and the BFF never sees the request. It sits before `bff-auth` so that an unauthenticated flood does not turn into a flood of verify calls. Clients behind one NAT share a budget. `/yjs` has no rate limit: it would count connects, not messages, and a reconnecting canvas must not lock itself out; limiting connects can follow if they turn out to be abused.

- **The public API** (`/public/v1`, [ADR 0033](../adr/0033-public-api-tokens-and-webhooks.md), #851, #852) is a router of its own (`public-api`) for scripts, not browsers: `security-headers`, then `public-api-ip-rate-limit` (`PUBLIC_API_IP_RATE_LIMIT_AVERAGE` requests a minute, default 1200, with a burst of `PUBLIC_API_IP_RATE_LIMIT_BURST`, default 120, **per client address**: a flood guard that also bounds made-up tokens, each of which costs the BFF a lookup), then `public-api-body-limit` (a body over 1 MiB is `413`). The limit **per token** (600 a minute, with `RateLimit-*` headers and `429`) is the BFF's ([bff.md](bff.md), "Public API"): only the BFF knows which token a request resolved to and can say how many requests are left. No `cors` (a browser page of another origin gets no answer it may read) and no `bff-auth`: the BFF's guard checks every request itself, because the verify call accepts Keycloak tokens of people only. The chart has the same route and middlewares (`edge.publicApi`).

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

## Security headers

The `security-headers` middleware (labels of the BFF service in `docker-compose.yml`, a `Middleware` in the chart's `edge.yaml`) sets `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy: no-referrer`, `Permissions-Policy` and `Cross-Origin-Opener-Policy` on the API's and the WebSocket's answers, and `Strict-Transport-Security` when `HSTS_MAX_AGE` (chart: `security.hstsMaxAge`) is above 0. It is first in each chain, so an answer a later middleware gives itself (401 from `bff-auth`, 429 from `rate-limit`) carries the headers too. The frontend's own headers and the Content-Security-Policy are the nginx image's ([frontend](frontend.md#headers)). `scripts/demo-smoke.sh` checks them with curl.

## Logs and metrics

Which scraper or dashboards run is not decided here; this is what the services provide (#347). Alert rules and a dashboard on them, to start from, are in [Operations](../operations.md).

The application logs are being moved to one JSON shape with a request id, and a local log viewer is added; the decisions are in [ADR 0025](../adr/0025-structured-logging-and-log-viewer.md).

- **Access logs** (Traefik, `accessLog` in `infra/traefik/traefik.yml`): one JSON object per request on stdout (`docker logs elysion-traefik-1`), with the client address, method, router and service, status, size and duration. **Redacted on purpose:** the query parameters are dropped from `RequestPath` (`fields.queryParameters.defaultMode: drop`, Traefik 3.7.3 or later), because the `/yjs` URL carries the WS token there (`?board=...&token=...`); the path is not logged at all (`fields.names.RequestPath: drop`, #734), because an invitation link carries its secret in it (`/invite/<token>`, `/api/invitations/<token>/accept`) and Traefik cannot redact part of a path; the router and service names say what was called. Request headers (`Authorization`, `Cookie`) are not logged either; the one header kept is `X-Request-Id` (`request_X-Request-Id`, `downstream_X-Request-Id`), a correlation key and not a secret ([ADR 0034](../adr/0034-aspire-dashboard-as-the-dev-log-viewer.md)). Application logs (BFF, realtime, business backend) go to stdout of their containers as before.
- **Metrics**, Prometheus text format, all on the compose network only (nothing is published to the host, and `/metrics` is not routed at the edge):

| Service          | URL                                    | What                                                                                                                                                                                                                                                                                       |
| ---------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Traefik          | `http://traefik:8082/metrics`          | own entry point `metrics` (`:8082`); requests, durations and open connections per entry point, router and service (`traefik_router_requests_total`, `traefik_service_request_duration_seconds`, ...)                                                                                       |
| BFF              | `http://bff:3000/metrics`              | process metrics, `elysion_bff_http_requests_total` and `elysion_bff_http_request_duration_seconds` by method, route pattern and status (also the requests the auth guard refuses); `elysion_bff_realtime_token_refusals_total` by `reason` (`no_role`, `not_uuid`)                         |
| Realtime         | `http://realtime:3000/metrics`         | process metrics, `elysion_realtime_websocket_connections` (admitted connections), `elysion_realtime_rooms` (boards held in memory); `elysion_realtime_document_saves_total`, `elysion_realtime_document_save_failures_total`, `elysion_realtime_document_size_bytes` (histogram, per save) |
| Business backend | `http://business-backend:8080/metrics` | process metrics, `http_request_duration_seconds` (count and buckets) by method, status and `endpoint` (the route pattern), `elysion_backend_db_commands_total` by `outcome` (`ok`, `error`)                                                                                                |

The BFF's route label is the route pattern (`/api/boards/:id`), never the URL, so ids and query strings cannot become label values; URLs no route matches share the label `unmatched`. The backend's `endpoint` label is the route pattern too (`/boards/{id:guid}`).

### The log viewer (dev stack)

[ADR 0025](../adr/0025-structured-logging-and-log-viewer.md), [ADR 0034](../adr/0034-aspire-dashboard-as-the-dev-log-viewer.md). `pnpm dev:logs` is `pnpm dev:stack` plus the standalone **Aspire dashboard** (`aspire-dashboard` in `docker-compose.yml`, the `logs` profile, so `docker compose up` and `pnpm demo` do not start it; pinned image, 512 MB, telemetry in memory only, so a restart empties it). Its UI is <http://localhost:18888> (`ASPIRE_DASHBOARD_PORT`) and its OTLP/HTTP endpoint `http://localhost:18890/v1/logs` (`ASPIRE_DASHBOARD_OTLP_PORT`), both on the loopback only (`docker-compose.dev.yml`); access is anonymous, which is why it is dev-only.

- **What is shipped.** The BFF, the realtime service and the business backend send every log line to `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` (OTLP over HTTP, protobuf; `LOGS_OTLP_ENDPOINT` in the compose file) next to stdout, which stays as it is. The variable is empty unless the stack was started with `pnpm dev:logs`: with it unset a service sends nothing and does not even load the OpenTelemetry packages. Traefik ships its access log through its experimental OTLP export (`experimental.otlpLogs`, `accessLog.otlp`, with `dualOutput` so stdout keeps it) over **gRPC** (`aspire-dashboard:18889`: Traefik's OTLP/HTTP exporter always gzips, and the dashboard's HTTP endpoint refuses gzip), configured in a generated copy of `traefik.yml` (`scripts/traefik-logs-config.mjs`, because Traefik reads one static configuration only). A viewer that is down loses lines; it never makes a service fail.
- **Resources.** Every sender sets `service.name` (`elysion-bff`, `elysion-realtime`, `elysion-business-backend`, `elysion-traefik`); the dashboard shows each as a resource of its own. The dashboard's OTLP/HTTP endpoint takes protobuf and JSON (uncompressed); the three services send protobuf over HTTP, Traefik over gRPC.
- **Field names in the viewer.** The message is the record's message, the time its timestamp, the level the word `level` (`trace` to `fatal`, in all three services; `severity_text` is OpenTelemetry's and holds Serilog's `Warning` for the backend). The Node services send the fields of their JSON line (dotted for nested ones: `http.route`, `err.type`) with the same names, as does the business backend for `requestId`, `userId` and its own properties (`reason`, `scheme`); the backend's request line carries Serilog's names (`RequestMethod`, `HttpRoute`, `StatusCode`, `Elapsed`) instead of the `http` object. Traefik's access log arrives as its JSON line in the message, with Traefik's names (`DownstreamStatus`, `RouterName`); it has no `requestId` attribute, because Traefik does not make one (the BFF does), but it keeps the one header `X-Request-Id` (`request_X-Request-Id` when the client sent one, `downstream_X-Request-Id` from the BFF's response), so a text search for the id finds its line.
- **Finding things** (<http://localhost:18888/structuredlogs>, resource "All"):
  - one request: the filter `requestId` equals the id from the `X-Request-Id` header of a response (the BFF, the backend, the realtime
    service), or the id typed into the search box, which also finds Traefik's line;
  - what the BFF warned about: resource `elysion-bff`, filter `level` equals `warn` (`level` across all components);
  - everything one person caused: the filter `userId` equals the token's `sub`.
  - Scripts read the same records as OTLP JSON from `http://localhost:18888/api/telemetry/logs` (anonymous, loopback only).

In the dev stack (`pnpm dev:stack`) the routes are Docker labels in `docker-compose.yml`; Traefik
routes over the `elysion_elysion` network, the compose project's own, and sees only the containers of that project
(`providers.docker.constraints`), so a second dev stack of another worktree (#890) is invisible to it and has its own Traefik.

## TLS

Decided in [ADR 0028](../adr/0028-production-topology-tls-and-keycloak.md): production is Kubernetes through the Helm chart, and the compose stack in this
repository serves plain HTTP on port 80 and is a demo and a development setup. In the chart the routes go on `websecure` with a certificate Secret that
cert-manager (or the operator's PKI) made (`edge.tlsSecretName`; the chart never does ACME), `edge.redirectToHttps` adds the redirect from `web`, and
`edge.hsts.maxAge` the HSTS header (`max-age=31536000`, no `includeSubDomains`, no `preload`). Traefik's own chart is configured without the dashboard and
without the Docker socket. Keycloak has its own host name and only `/realms/` and `/resources/` are routed to it. The chart part is implemented (#674: `edge.redirectToHttps`, `security.hstsMaxAge`, `values-production.example.yaml`, and a CI check that no development value is in the rendering of the example); the production realm and the guide follow (#675, #676).

## In Kubernetes

The same routes and middlewares are rendered by the Helm chart (`infra/helm/elysion`, [ADR 0018](../adr/0018-kubernetes-packaging.md)) as Traefik `Middleware` and `IngressRoute` resources (`edge.*` values); the forwardAuth address carries the namespace of the BFF's Service, because Traefik runs in its own. A local `kind` deployment is described in `infra/kind/README.md`.

## Open questions

- Authentication: the identity provider is Keycloak and services only validate tokens ([ADR 0014](../adr/0014-keycloak-identity-provider.md)); how the edge enforces it (forwardAuth to the BFF, since Traefik OSS has no JWT middleware) is in [identity.md](identity.md), implemented in #121 (see "Edge authentication").
- Final choice between Traefik-only vs. dedicated API gateway (Kong/APIM) for production.
