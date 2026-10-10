# Elysion Helm chart

Deploys the four application services (frontend, BFF, realtime, business backend) and, for Traefik, the edge resources
(`Middleware` for forwardAuth, CORS and the rate limit, and one `IngressRoute` with the routes of the dev stack:
`/api`, `/yjs`, `/`). Decision and reasoning: [ADR 0018](../../../docs/adr/0018-kubernetes-packaging.md).

**Not in the chart:** Postgres, Valkey, the object store and Keycloak. They are external services; the chart only
needs their addresses, and the passwords are in a Secret you provide. The Traefik controller (with its CRDs) has to
be installed in the cluster.

```sh
helm upgrade --install elysion infra/helm/elysion -n elysion \
  -f infra/helm/elysion/values-kind.yaml       # or your own values file
helm lint infra/helm/elysion -f infra/helm/elysion/values-kind.yaml
```

## Values you have to set

| Value                     | Meaning                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `oidc.issuerUrl`          | The Keycloak realm URL **as it appears in the tokens** (what the browser logs in at). Required.      |
| `oidc.jwksUri`            | Where the services fetch the realm's keys, when that differs from the issuer (cluster-internal URL). |
| `objectStore.endpoint`    | The S3 API that keeps the files (images) of boards. Required; bucket and limits have defaults.       |
| `images.*`                | Repository, tag and pull policy of the four images (built from the repository's Dockerfiles).        |
| `edge.host`               | Host name the routes answer for (empty: any).                                                        |
| `edge.corsAllowedOrigins` | Origins that get CORS headers on `/api` and `/yjs`.                                                  |
| `secrets.existingSecret`  | Name of the Secret below (default `elysion-secrets`).                                                |

Everything else (replicas, resources, rate limit, entry points, TLS secret) has a default in `values.yaml`.

## The Secret

No secret is ever a value of a committed file. Create the Secret yourself (or let your secret operator create it):

```sh
kubectl -n elysion create secret generic elysion-secrets \
  --from-literal=WS_TOKEN_SECRET="$(openssl rand -hex 32)" \
  --from-literal=INTERNAL_API_SECRET="$(openssl rand -hex 32)" \
  --from-literal=POSTGRES_CONNECTION_STRING='Host=...;Port=5432;Database=elysion;Username=...;Password=...' \
  --from-literal=REDIS_URL='redis://valkey.example:6379' \
  --from-literal=S3_ACCESS_KEY='...' \
  --from-literal=S3_SECRET_KEY='...'
```

`WS_TOKEN_SECRET` (BFF and realtime) and `INTERNAL_API_SECRET` (realtime and business backend) are different values of
at least 32 characters. For a throwaway install `secrets.create=true` renders the Secret from `secrets.values`; those
values then sit in the Helm release, so do not use it for anything that matters.

## Backup

The chart does not run Postgres, Keycloak's database or the object store, so their backup is theirs: the database service's own, and your S3
service's versioning or replication. [`../examples/backup-cronjob.yaml`](../examples/backup-cronjob.yaml) is a CronJob that runs the same script as the
compose stack's backup service (`infra/backup/backup.sh`, `pg_dump` of `elysion` and `keycloak`). Restoring is `infra/backup/restore.sh`, see
[self-hosting](../../../docs/self-hosting.md#back-up-and-restore).

## Notes

- **Pods are hardened** (#691): every container runs as a non-root numeric user (frontend 101, Node services 1000, business backend 1654) with a
  read-only root file system (`/tmp` and, for nginx, `/etc/nginx/conf.d` are `emptyDir`), all capabilities dropped, no privilege escalation and the
  `RuntimeDefault` seccomp profile. The images already run as that user, so a cluster that enforces the `restricted` Pod Security level accepts them. The
  frontend listens on 8080 (nginx-unprivileged). The realtime pod has 60 s to stop: it saves the boards with unsaved changes on SIGTERM.
- The services' probes are `/health` (frontend: `/`), each behind a start-up probe (the business backend may take up to 3 minutes: it migrates at start). The business backend applies its migrations itself at start
  (`migrateOnStartup`).
- More than one realtime replica is fine: rooms are kept in step through Valkey, no sticky sessions needed.
- `/metrics` of the BFF and realtime are on the services' ports inside the cluster and are not routed by the edge.
- Try it locally with a `kind` cluster: [infra/kind](../../kind/README.md).
