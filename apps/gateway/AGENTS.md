# apps/gateway — Agent Instructions

This directory is currently empty. Elysion's gateway is Traefik, not a custom service — its config lives in:

- `infra/traefik/traefik.yml` — static config (dashboard, entrypoints incl. the internal `metrics` one, docker provider, file provider, JSON access log, Prometheus metrics)
- `infra/traefik/dynamic/middlewares.yml` — middlewares routers refer to as `<name>@file` (`bff-auth`: forwardAuth to the BFF)
- `docker-compose.yml` — the `traefik` service, plus `traefik.enable`/router labels on each routed service; the `cors` and `rate-limit` middlewares are labels on the `bff` service (they read `CORS_ALLOWED_ORIGINS`, `RATE_LIMIT_AVERAGE`, `RATE_LIMIT_BURST` from the environment, which the dynamic file cannot)

See `docs/specs/gateway.md` and `docs/adr/0001-gateway-and-bff.md`.

If a feature ever needs custom gateway logic that Traefik's dynamic config/middlewares can't express, that's when code would land in this directory — until then, treat gateway changes as Traefik config changes, not application code.

## Routing convention

- `/api/*` → BFF, `middlewares=cors,rate-limit,bff-auth@file`: **authenticated at the edge** (forwardAuth to `http://bff:3000/api/auth/verify`), after CORS (answers preflights) and the rate limit (429)
- `/yjs` → realtime backend (WebSocket; the canvas connects to `/yjs?board=<id>&token=<ws token>`), `middlewares=cors`, **not** forwardAuth'd or rate-limited: the WS token is the check and the realtime service verifies it
- `/internal` → no edge route; the business backend is reachable only on the compose network (`http://business-backend:8080`)
- `/` → frontend (priority 1, so every more specific route wins), public

A new route is public unless it says otherwise: decide for each one whether it gets `bff-auth@file`, and write it into the routing table in `docs/specs/gateway.md`. Never apply forwardAuth to `/yjs` (a browser WebSocket cannot send the header).

Traefik is told to route over `elysion_elysion`, the compose project's network (`providers.docker.network` in `traefik.yml`; the project is called `elysion`, so keep that `name` in `docker-compose.yml`), and to see only that project's containers (`providers.docker.constraints` on the label `com.docker.compose.project`): a second dev stack of another worktree (#890, `ELYSION_STACK`) has the same router names. For such a stack `scripts/dev-stack.mjs` writes both lines with its name into a generated copy (`forStack` in `scripts/traefik-logs-config.mjs`); keep them as they are, a test fails without them. Its host ports (80, 8080) are `TRAEFIK_PORT` and `TRAEFIK_DASHBOARD_PORT`, which `ELYSION_PORT_OFFSET` moves (`scripts/dev-stack-config.mjs`). A new routed service needs `traefik.enable=true`, a router rule and `loadbalancer.server.port` labels.

Verify routing changes with `pnpm dev:stack` and `curl` against `http://localhost/...` (a second stack: its offset port) — the Traefik dashboard (`:8080/dashboard/`) shows registered routers if something isn't matching.

## Logs and metrics

`pnpm dev:logs` also ships the access log to the log viewer (the Aspire dashboard, ADR 0034): Traefik reads one static configuration only, so `scripts/traefik-logs-config.mjs` inserts the OTLP export at the `# logs:otlp` marker of `traefik.yml` and writes a generated copy (`infra/traefik/.traefik.generated.yml`, ignored by git) that compose mounts instead. Keep the marker in `accessLog`; a test (`.github/scripts/traefik-logs-config.test.mjs`) fails without it. The export goes over gRPC (`aspire-dashboard:18889`), not HTTP: Traefik's OTLP/HTTP exporter gzips every batch and the dashboard refuses it. The query parameters stay dropped there too.

Access logs are JSON on stdout and **must not contain query strings**: the `/yjs` URL carries the WS token, and Traefik's `RequestPath` includes the query, so the query parameters are dropped (`accessLog.fields.queryParameters.defaultMode: drop`). Do not change that to `keep`, and do not log request headers: the one exception is `X-Request-Id` (`accessLog.fields.headers.names`), a correlation key and not a secret (ADR 0025, ADR 0034); do not add another. `RequestPath` is dropped as well (`fields.names`), because invitation links carry a secret in the path (#734); do not bring it back. The Prometheus metrics of Traefik (`:8082`, entry point `metrics`), the BFF and realtime (`/metrics`) are for the compose network only; see "Logs and metrics" in `docs/specs/gateway.md`. Static config changes need `docker compose restart traefik` (the dynamic file is watched, `traefik.yml` is not).
