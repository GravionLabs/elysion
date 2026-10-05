# apps/gateway — Agent Instructions

This directory is currently empty. Elysion's gateway is Traefik, not a custom service — its config lives in:

- `infra/traefik/traefik.yml` — static config (dashboard, entrypoints, docker provider)
- `infra/docker/docker-compose.yml` — the `traefik` service, plus `traefik.enable`/router labels on each routed service

See `docs/specs/gateway.md` and `docs/adr/0001-gateway-and-bff.md`.

If a feature ever needs custom gateway logic that Traefik's dynamic config/middlewares can't express, that's when code would land in this directory — until then, treat gateway changes as Traefik config changes, not application code.

## Routing convention

- `/api/*` → BFF
- `/yjs` → realtime backend (WebSocket; the canvas connects to `/yjs?board=<id>`)
- `/internal` → no edge route; the business backend is reachable only on the compose network (`http://business-backend:8080`)
- `/` → frontend (priority 1, so every more specific route wins)

Services also join `local-infra`, so Traefik is told to route over `elysion_elysion` (`providers.docker.network` in `traefik.yml`); a new routed service needs `traefik.enable=true`, a router rule and `loadbalancer.server.port` labels.

Verify routing changes with `pnpm dev:stack` and `curl` against `http://localhost/...` — the Traefik dashboard (`:8080/dashboard/`) shows registered routers if something isn't matching.
