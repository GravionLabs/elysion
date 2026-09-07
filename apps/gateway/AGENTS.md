# apps/gateway — Agent Instructions

This directory is currently empty. Elysion's gateway is Traefik, not a custom service — its config lives in:

- `infra/traefik/traefik.yml` — static config (dashboard, entrypoints, docker provider)
- `infra/docker/docker-compose.yml` — the `traefik` service, plus `traefik.enable`/router labels on each routed service

See `docs/specs/gateway.md` and `docs/adr/0001-gateway-and-bff.md`.

If a feature ever needs custom gateway logic that Traefik's dynamic config/middlewares can't express, that's when code would land in this directory — until then, treat gateway changes as Traefik config changes, not application code.

## Routing convention

- `/api/*` → BFF
- `/realtime/*` → realtime backend
- `/internal/*` → business backend (internal only)

Verify routing changes with `docker compose up -d traefik <target-service>` and `curl` against the routed path — the Traefik dashboard (`:8080/dashboard/`) shows registered routers if something isn't matching.
