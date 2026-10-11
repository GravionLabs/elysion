# ADR 0023: Elysion's own Valkey, and one compose file for the whole stack

- Status: Accepted
- Date: 2026-10-08
- Supersedes in part: [ADR 0006](0006-shared-local-infrastructure.md)
- Builds on: [ADR 0021](0021-versioning-and-releases.md)

## Context

ADR 0006 kept Valkey out of Elysion's compose file: it ran once per machine in `../local-infra` and every project shared it. That made
`docker compose up` in this repository useless on its own (the development stack failed without local-infra), so a **demo** and the
**published images** needed a second compose file with a Valkey of its own (`docker-compose.demo.yaml`, about 200 lines copied from the
first). Two files drift, the one that people find first was the one that does not run by itself, and Valkey was defined in three places (local-infra, the demo, CI).

Sharing a Valkey saves a few megabytes and costs the independence of the stack. Putting every project on one Docker network instead (so a
shared Valkey is visible next to Elysion's own) does not work either: two containers with the same network alias are both returned by Docker's DNS,
so a service could reach either of them, and presence and sync would split silently; with different names the shared network does nothing.
The real nuisance of local-infra is host port 6379.

## Decision

1. **One compose file, `docker-compose.yml` in the repository root, defines the whole stack:** Traefik, the four apps, Postgres, Keycloak and
   **Valkey**. `docker compose up -d` runs it from the published images (`ELYSION_VERSION`, `next` by default), `docker compose up -d --build` builds them
   from the checkout (`pnpm demo`). The project is called `elysion` (`name:`), which Traefik's `providers.docker.network` (`elysion_elysion`) relies on.
2. **Valkey is Elysion's own,** with the image and the settings of local-infra's (`valkey/valkey:9.1.2-alpine`, `ALLOW_EMPTY_PASSWORD`), a volume of its own
   and **no published port**. Containers use `valkey:6379`. No external network, nothing from the machine.
3. **`docker-compose.dev.yml`** is the only addition for working on Elysion (`pnpm dev:infra` and `pnpm dev:stack` use it, with `-f` on top of the first file): host ports for
   Postgres (5432), the Traefik dashboard (8080) and **Valkey on 6380**, and the reserved RustFS (9100 and 9101). 6380, not 6379, so it does not clash with a Valkey of
   local-infra (or anything else) on the machine; apps on the host use `REDIS_URL=redis://:dev-only-valkey-password@localhost:6380`. It is not named `docker-compose.override.yml` on purpose, so that
   a plain `docker compose up` never publishes a database.
4. **The settings are in `.env`** (copied from `.env.example`): the version, Keycloak's port, CORS and the rate limit, and the dev host ports.
5. **What stays of ADR 0006:** the key and channel prefix `elysion:`, RustFS on 9100 and 9101, and the rule that RabbitMQ and Portainer are not defined in Elysion's compose file
   (Elysion does not need them). The pre-launch check for local-infra in `scripts/dev-stack.mjs` and in the VS Code tasks is gone.

## Consequences

- A fresh clone, or just the compose file, runs the whole of Elysion with Docker alone. The demo compose file and its duplicate definitions are gone; `pnpm demo` and
  `pnpm dev:stack` are the same stack, the second one with host ports.
- The Valkey of the stack is a second Valkey on a machine that also runs local-infra: a few megabytes of memory. Data of the old shared instance is not carried over (presence is
  not durable data).
- `pnpm dev:stack` and `pnpm demo` now share one project, so one set of containers and volumes; the data volumes of the former development stack (`elysion_postgres-data`) are reused.
  The Keycloak realm is imported only into an empty Keycloak database: an existing one does not get `dev1` and `dev2` until it is dropped.
- The realtime end-to-end tests locally need `REDIS_URL=redis://:dev-only-valkey-password@localhost:6380` (CI has a service container on 6379); the realtime service's default stays `redis://localhost:6379`.
- The identity provider's address is still `localhost` in the file; a host name variable for a real deployment is a separate change (see [self-hosting](../self-hosting.md)).
