# apps/gateway — Agent Instructions

This directory is currently empty. Elysion's gateway is Traefik, not a custom service — its config lives in:

- `infra/traefik/traefik.yml` — static config (dashboard, entrypoints, docker provider, file provider)
- `infra/traefik/dynamic/middlewares.yml` — middlewares routers refer to as `<name>@file` (`bff-auth`: forwardAuth to the BFF)
- `infra/docker/docker-compose.yml` — the `traefik` service, plus `traefik.enable`/router labels on each routed service

See `docs/specs/gateway.md` and `docs/adr/0001-gateway-and-bff.md`.

If a feature ever needs custom gateway logic that Traefik's dynamic config/middlewares can't express, that's when code would land in this directory — until then, treat gateway changes as Traefik config changes, not application code.

## Routing convention

- `/api/*` → BFF, **authenticated at the edge** (`middlewares=bff-auth@file`: forwardAuth to `http://bff:3000/api/auth/verify`)
- `/yjs` → realtime backend (WebSocket; the canvas connects to `/yjs?board=<id>&token=<ws token>`), **not** forwardAuth'd: the WS token is the check and the realtime service verifies it
- `/internal` → no edge route; the business backend is reachable only on the compose network (`http://business-backend:8080`)
- `/` → frontend (priority 1, so every more specific route wins), public

A new route is public unless it says otherwise: decide for each one whether it gets `bff-auth@file`, and write it into the routing table in `docs/specs/gateway.md`. Never apply forwardAuth to `/yjs` (a browser WebSocket cannot send the header).

Services also join `local-infra`, so Traefik is told to route over `elysion_elysion` (`providers.docker.network` in `traefik.yml`); a new routed service needs `traefik.enable=true`, a router rule and `loadbalancer.server.port` labels.

Verify routing changes with `pnpm dev:stack` and `curl` against `http://localhost/...` — the Traefik dashboard (`:8080/dashboard/`) shows registered routers if something isn't matching.
