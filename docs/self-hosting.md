# Self-hosting Elysion

Elysion is a **pre-release**. It runs end to end and the images are published, but the stack in this repository is a
demo and a development setup, not a production one. This page says how to run the published images and what has to change
before anything real depends on them.

## The images

Every merge to `main` that passes the checks publishes four images to GHCR and creates a GitHub release
([ADR 0021](adr/0021-versioning-and-releases.md)):

| Image                                          | What it is                                       |
| ---------------------------------------------- | ------------------------------------------------ |
| `ghcr.io/gravionlabs/elysion-frontend`         | the Angular app with the canvas, served by nginx |
| `ghcr.io/gravionlabs/elysion-bff`              | the NestJS backend-for-frontend (`/api`)         |
| `ghcr.io/gravionlabs/elysion-realtime`         | the NestJS WebSocket service (`/yjs`)            |
| `ghcr.io/gravionlabs/elysion-business-backend` | the .NET 10 API: boards, rooms, templates, roles |

They are built for `linux/amd64` and `linux/arm64`. While the version has a pre-release label (`0.1.0-beta.126`) the tags are the
version, the version with the commit (`0.1.0-beta.126-abc1234`) and the moving tag **`next`**, the newest pre-release; there is no
`latest` until there is a stable release, which also gets `1` and `1.0`. The releases and their notes are on the
[releases page](https://github.com/GravionLabs/elysion/releases).

## Run the demo from the published images

You need Docker with Compose and this repository (the stack mounts the Traefik configuration and the Keycloak realm from it).

```sh
git clone https://github.com/GravionLabs/elysion.git && cd elysion
ELYSION_VERSION=next docker compose up -d --pull always
bash scripts/demo-smoke.sh        # optional: checks that it works end to end
```

Then open <http://localhost> and log in as `dev`, `dev1` or `dev2` (the password is the username). Use a version instead of `next`
to pin one (`ELYSION_VERSION=0.1.0-beta.126`). Settings (`ELYSION_VERSION`, ports) can also go into a `.env` (copy `.env.example`). `pnpm demo` builds the images from the checkout instead.
`docker compose down` stops it, and `down -v` also forgets the data.

The stack is Traefik (port 80), the four images, Postgres, Valkey (its own, for the realtime service), RustFS (the object store that keeps the images of boards) and Keycloak (port 8081,
admin console `admin` / `admin`). The business backend applies its database migrations when it starts.

## What a real deployment needs

The topology (TLS, host names, where Keycloak sits) is proposed in [ADR 0028](adr/0028-production-topology-tls-and-keycloak.md); production is Kubernetes through the Helm chart, and compose stays the demo; the work that implements it is #673 (to be rewritten once the ADR is accepted).

The demo is wired to `localhost` and uses development values. Before it faces anybody else:

- **A host name and TLS.** The identity provider's address is part of every token: `OIDC_ISSUER_URL` (the address the browser uses) is
  `http://localhost:8081/realms/elysion` in the demo, in the frontend, the business backend and the BFF. Put TLS in front (Traefik or your
  ingress), and set the issuer, the redirect URIs and the web origins of the realm's clients to your host name.
- **A production Keycloak:** not `start-dev` with an imported demo realm. Create your own realm, clients and users, a strong admin
  password, and a database of its own ([ADR 0014](adr/0014-keycloak-identity-provider.md)).
- **Your own secrets.** `WS_TOKEN_SECRET` (BFF and realtime, [identity](specs/identity.md)) and `INTERNAL_API_SECRET` (realtime and business backend, [ADR 0017](adr/0017-internal-api-authentication.md))
  have development values in the compose file: set long random ones, the same in the services that share them.
- **Postgres with backups** (the demo's volume is a convenience), and Valkey if you run more than one realtime instance.
- **An object store for the images of boards:** the business backend needs any S3-compatible service (path-style addressing) and does not start without
  one it can reach. It takes `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` and `S3_BUCKET` (default `elysion-files`, created at start if it is missing),
  and the limits `MAX_FILE_BYTES` (10 MiB) and `MAX_FILES_PER_BOARD` (200). The demo's RustFS has development credentials and no host port; in
  production use your own S3 (the chart's `objectStore.endpoint`, and `S3_ACCESS_KEY` and `S3_SECRET_KEY` in its Secret). The bucket is state: **back it up
  like the database** (the files are named `boards/<board id>/<file id>`, and a board's document refers to them).
- **Keycloak and the network:** the compose file publishes Keycloak (with its development admin password) on the loopback only (`KEYCLOAK_BIND`); in a real deployment it sits behind your TLS proxy and has no development admin at all.
- **A Content-Security-Policy.** The frontend image sends `X-Content-Type-Options`, `Referrer-Policy` and `X-Frame-Options`, but no CSP yet; set one at your proxy once you know the identity provider's origin.
- **CORS and the rate limit:** `CORS_ALLOWED_ORIGINS`, `RATE_LIMIT_AVERAGE` and `RATE_LIMIT_BURST` ([gateway](specs/gateway.md)).

The Helm chart ([ADR 0018](adr/0018-kubernetes-packaging.md), `infra/helm/elysion`) is the way to run it on Kubernetes; its default image
names are still the local ones (`elysion/frontend`, ...), so set `images.<service>.repository` and `tag` to the GHCR images above. It has
been run on a local kind cluster only.

## Back up and restore

The state of Elysion is in three places: **Postgres** (boards, members, the stored document of every board, and Keycloak's own database `keycloak` with the users),
**the object store's bucket** (the images of boards, `boards/<board id>/<file id>`; a board's document refers to them), and your configuration. The
`backup` service of the compose stack covers the first two; it is behind the profile `backup`, so the demo does not run it:

```sh
docker compose --profile backup up -d backup
```

It runs `pg_dump` of `elysion` and `keycloak` (custom format, compressed) and copies the bucket into a directory per run, `backup-data/<UTC time>/` in the
volume `backup-data` (or a path of the host: `BACKUP_PATH=/srv/elysion-backups` in `.env`). `BACKUP_CRON` (default `0 3 * * *`, cron syntax) says when,
`BACKUP_KEEP_DAYS` (default 14) how long runs are kept. Every run ends with one line in the container's log, `backup ok <directory> <bytes>` or
`backup FAILED: <why>`, and writes the epoch seconds of the last good run into `last-success` next to the runs, for a check that does not read logs. One
run by hand: `docker compose --profile backup run --rm backup backup.sh`.

**Restore** with `scripts/restore.sh <time of the run | latest> [--force]`: it stops the services that use the databases, restores `elysion`, `keycloak`
and the bucket from that run, and starts the services again. A database that has tables, or a bucket that is not empty, is **not touched without
`--force`** (it is then dropped and made again, and the bucket made equal to the backup).

The backup is only worth what a restore brings back: `scripts/backup-rehearsal.sh` makes two boards (one with an image), backs up, destroys the databases
and the bucket's files, restores and checks that the boards and the image are back. The container workflow runs it on every pull request that touches the
stack; run it by hand only on a stack you can lose data in.

Two things the service does not do: **the backup sits on the same host** unless you point `BACKUP_PATH` somewhere else and copy it away (a backup on the
disk of the database it protects is not a backup), and the **development credentials** of the stack are the ones it uses. In Kubernetes the chart does not run
Postgres or the object store, so their backup is theirs; [the chart's example](../infra/helm/examples/backup-cronjob.yaml) is a CronJob with the same
script for the databases.

## Known limits of this pre-release

See [What is missing](../README.md#what-is-missing) and the [roadmap](roadmap.md): no production configuration yet, no security review
yet, no browser end-to-end tests, and votes that are not secret from the server.
