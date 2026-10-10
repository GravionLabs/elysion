# Self-hosting Elysion

Elysion is a **pre-release**. It runs end to end and the images are published, but the stack in this repository is a
demo and a development setup; production is Kubernetes through the Helm chart. This page says how to run the published images as a demo and how to install the chart.

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

This is the demo: plain HTTP, development values, a Keycloak in development mode. For anything real see [Run it in Kubernetes](#run-it-in-kubernetes).

The stack is Traefik (port 80), the four images, Postgres, Valkey (its own, for the realtime service), RustFS (the object store that keeps the images of boards) and Keycloak (port 8081,
admin console `admin` / `admin`). The business backend applies its database migrations when it starts.

## Run it in Kubernetes

Production is Kubernetes through the Helm chart (`infra/helm/elysion`, [ADR 0018](adr/0018-kubernetes-packaging.md)); the compose stack above is the demo and
stays on plain HTTP with development values. The topology is decided in [ADR 0028](adr/0028-production-topology-tls-and-keycloak.md): the application on
one host name (`elysion.example` below), the identity provider on its own (`id.example`), both behind Traefik with TLS, and **Keycloak run by you**, not by the
chart. The chart has been run on a local kind cluster ([infra/kind](../infra/kind/README.md)) and has not yet been run on a managed cluster.

### What you bring

| You need                                                                                           | Why                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A cluster and `helm`                                                                               | The chart is in this repository (`infra/helm/elysion`); install from a checkout of the tag you run.                                                                                    |
| **Traefik** with its CRDs ([Traefik's chart](https://github.com/traefik/traefik-helm-chart))       | The edge: the chart renders Traefik `Middleware` and `IngressRoute` resources. Configure it **without** the dashboard, without `api.insecure` and without a Docker socket (see below). |
| **cert-manager** (or your PKI)                                                                     | Makes the TLS Secret. The chart never talks to an ACME server.                                                                                                                         |
| Two DNS names to the cluster's ingress: `elysion.example` and `id.example`                         | The application and the identity provider. Use two names of one registrable domain (sibling subdomains) so that cookies stay first-party.                                              |
| **Postgres** for Elysion, **Valkey**, an **S3-compatible object store** (path-style) with a bucket | Nothing of this is in the chart. Back up Postgres and the bucket yourself ([Back up and restore](#back-up-and-restore)).                                                               |
| **Keycloak** in production mode with a database of its own, or another OpenID Connect provider     | Below. The services only validate tokens ([ADR 0014](adr/0014-keycloak-identity-provider.md)).                                                                                         |

### 1. Certificates

One **wildcard certificate** for `*.example.com` is enough for both hosts; cert-manager gets it with DNS-01, or your PKI issues it. What the chart needs is a Secret
of type `kubernetes.io/tls` in Elysion's namespace (`edge.tlsSecretName`); the Keycloak ingress names the same Secret (or its own, in its namespace). How the
certificate is obtained (HTTP-01, DNS-01, an internal CA) is the cluster's business.

### 2. Traefik

Install Traefik in its own namespace with its Kubernetes CRD provider and the entry points `web` (80) and `websecure` (443). The values that matter, in
Traefik's chart: `api.dashboard: false`, `api.insecure: false`, the `metrics` entry point not exposed, and **no Docker provider** (the dev stack mounts the
Docker socket into Traefik; a service that can read the Docker API can read every container's environment, secrets included, which is one more reason the compose file is development only).

### 3. Keycloak

Run Keycloak next to the release (the [Keycloak Operator](https://www.keycloak.org/operator/installation) is one way; any chart or an existing Keycloak works the
same, and so does another provider that speaks OpenID Connect). Elysion's side of it is a set of settings and a realm file:

- `start` (production mode), a Postgres of its own, `KC_HOSTNAME=https://id.example`, `KC_PROXY_HEADERS=xforwarded`, `KC_HTTP_ENABLED=true` behind the ingress,
  `KC_HOSTNAME_ADMIN` an internal address.
- The ingress in front of Keycloak routes **only `/realms/` and `/resources/`** (login, tokens, keys, the account pages and their assets). **`/admin` and the master
  realm are not routed**; administer from inside the cluster (`kubectl port-forward`). Replace the bootstrap admin (`KC_BOOTSTRAP_ADMIN_*`, first start only) with a
  named administrator and delete it.
- **The realm:** every release has `realm-elysion.production.json` among its assets ([releases](https://github.com/GravionLabs/elysion/releases)), derived from the
  development realm by `scripts/build-realm.mjs`: no users, no direct password grant, `sslRequired: external`. Import it into an **empty** realm with the environment of
  Keycloak set (it substitutes the placeholders): `ELYSION_APP_URL=https://elysion.example` (no trailing slash) and `ELYSION_BFF_CLIENT_SECRET` (a long random string; the
  BFF client's secret). Then add your users, or an identity provider ([ADR 0027](adr/0027-enterprise-sign-in-groups-and-administration.md)).

### 4. The Secret

Create the Secret before the first install (the migration job needs it); nothing secret goes into a values file. `secrets.existingSecret` names it (default
`elysion-secrets`); the keys are listed in `values.yaml`:

```sh
kubectl create namespace elysion
kubectl -n elysion create secret generic elysion-secrets \
  --from-literal=WS_TOKEN_SECRET="$(openssl rand -base64 48)" \
  --from-literal=INTERNAL_API_SECRET="$(openssl rand -base64 48)" \
  --from-literal=POSTGRES_CONNECTION_STRING='Host=...;Database=elysion;Username=...;Password=...' \
  --from-literal=REDIS_URL='redis://...' \
  --from-literal=S3_ACCESS_KEY=... --from-literal=S3_SECRET_KEY=...
```

`WS_TOKEN_SECRET` ([identity](specs/identity.md)) and `INTERNAL_API_SECRET` ([ADR 0017](adr/0017-internal-api-authentication.md)) are different values of at least
32 characters. The bucket (`objectStore.bucket`, default `elysion-files`) is created at start if it is missing, so the key needs to be allowed to do that; the limits are
`MAX_FILE_BYTES` (10 MiB) and `MAX_FILES_PER_BOARD` (200). The bucket is state: **back it up like the database**.

### 5. Install

Copy [`values-production.example.yaml`](../infra/helm/elysion/values-production.example.yaml), replace the `*.example` names and the image tags (the chart's default
repositories are the local ones; use `ghcr.io/gravionlabs/elysion-*` and a version, [The images](#the-images)), and install:

```sh
helm upgrade --install elysion infra/helm/elysion -n elysion -f my-values.yaml
```

What the example sets: the routes on `websecure` with `edge.tlsSecretName`, `edge.redirectToHttps` (a permanent redirect from `web`), `security.hstsMaxAge`, two replicas of
every service, the migration job, an autoscaler for the realtime service, network policies and a `ServiceMonitor`; `oidc.issuerUrl` is
`https://id.example/realms/elysion`, the address in the tokens, and the services fetch the keys from it (set `oidc.jwksUri` when you want them to use a cluster-internal
address). The chart's [README](../infra/helm/elysion/README.md) explains each value. CI renders the example and fails if a value of the demo (`admin/admin`, `dev-only-`,
`localhost`, ...) is in it, and the chart refuses an empty `secrets.existingSecret`.

**HSTS:** the example starts with `604800` (one week). A wrong HSTS header cannot be taken back from a browser that has seen it, so raise it to `31536000` once
everything works. There is no `includeSubDomains` and no `preload`: those commit a whole domain, which is not Elysion's to commit.

### 6. Check it

Open `https://elysion.example`, log in with a user you made in the realm, create a board and open it in a second browser. `http://elysion.example` redirects, the
Traefik dashboard and Keycloak's `/admin` are not reachable from outside, and `https://elysion.example/api/boards` without a token is a `401`. Headers, the
Content-Security-Policy and how to loosen it for a customization of yours (`security.cspMode: report`, then read `CSP violation` in the BFF's log) are in the
[frontend spec](specs/frontend.md#headers). CORS and the rate limit are `edge.corsAllowedOrigins` and `edge.rateLimit.*` ([gateway](specs/gateway.md)).

### Rotate a secret

`WS_TOKEN_SECRET` and `INTERNAL_API_SECRET` are shared by two services each: change the value in the Secret and restart both services together (`kubectl -n elysion rollout restart
deploy/elysion-bff deploy/elysion-realtime`, and `deploy/elysion-business-backend` for the internal one). Open sockets keep working until they reconnect; a WS token lives about a
minute, so the only effect is a fresh token. To rotate the BFF client's secret, change it in Keycloak's client and in the environment you import with, then restart the BFF. A database
or S3 key is changed at its owner first and in the Secret second.

### Checklist

| Item                                                       | Who                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| TLS at the edge, redirect from HTTP, HSTS                  | The chart, with your certificate Secret                                                    |
| Security headers and an enforced CSP                       | The chart and the images                                                                   |
| Realm without users, without password grant                | The release asset; you import it                                                           |
| Own secrets, no development value                          | You (the Secret); CI checks the chart                                                      |
| Traefik without dashboard and Docker socket                | You (Traefik's values)                                                                     |
| Keycloak in production mode, admin not routed, named admin | You                                                                                        |
| Postgres, Valkey, object store, and their backups          | You                                                                                        |
| Alerts and dashboards                                      | [Operations](operations.md) (Prometheus Operator `ServiceMonitor` is in the chart example) |

Not part of this yet: Keycloak as an optional part of the chart, and Microsoft Entra ID without Keycloak ([ADR 0028](adr/0028-production-topology-tls-and-keycloak.md),
[ADR 0027](adr/0027-enterprise-sign-in-groups-and-administration.md)).

## Update

Pull the new images (`ELYSION_VERSION` in `.env`, or `docker compose pull && docker compose up -d`; in Kubernetes a new `images.<service>.tag` and `helm upgrade`).
The database is migrated by the business backend when it starts, the Helm chart does it in a job first (`migrateJob.enabled`). **Read the release notes before
you update:** a change that needs a step from you (a setting, a manual migration) is under **Breaking changes**, the first heading of the notes. Take a
[backup](#back-up-and-restore) first.

Every pull request is tested as an upgrade: the stack of the **last pre-release** is filled with rooms, boards with content, a template and a voting, the
pull request's images are started against the same volumes, and everything has to be there (`scripts/fill-stack.mjs`, the `upgrade` job of
`.github/workflows/container.yml`). A downgrade is not tested: restore the backup you took.

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

## Watch it

Prometheus, Alertmanager and Grafana are an overlay of the compose file (`docker-compose.observability.yml`), with alert rules for a service that is down, 5xx errors, slow
requests, saves that fail, a backup that is too old and more; [Operations](operations.md) starts it, explains each alert and says what to do.

## Known limits of this pre-release

See [What is missing](../README.md#what-is-missing) and the [roadmap](roadmap.md): the Kubernetes setup above is untested on a managed cluster, a [security review](security.md) whose findings are still being fixed,
and votes that are not secret from the server.
