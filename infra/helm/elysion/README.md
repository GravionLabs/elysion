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

| `replicas.*` | Replicas per component. With more than one, a PodDisruptionBudget (`minAvailable: 1`) and a spread over nodes are rendered. |
| `migrateJob.enabled` | Migrate with a Helm hook job (`--migrate`) before install and upgrade; the replicas then do not migrate at start. Use it above one backend replica. |
| `autoscaling.realtime.*` | An HPA for the realtime service on CPU (`cpuTarget`) and, with the Prometheus adapter, connections per pod (`connectionsTarget`). |
| `networkPolicy.*` | Ingress NetworkPolicies per component (`traefikNamespace`, `monitoringNamespace`). |
| `monitoring.serviceMonitor.*` | A Prometheus Operator `ServiceMonitor` for the BFF, the realtime service and the business backend. |

Everything else (resources, rate limit, entry points, TLS secret) has a default in `values.yaml`. [`values-production.example.yaml`](values-production.example.yaml)
puts the settings of a real cluster together (two replicas, the job, the autoscaler, the policies, a TLS Secret; every host is a `*.example` placeholder).

## Availability

- **Migrations:** with `migrateJob.enabled` a Helm hook job runs the business backend image with `--migrate` before the new pods are applied; the release waits, and a
  failed migration stops the upgrade with the old pods still serving. The Secret has to exist before the first install (the job reads it), so not `secrets.create`.
- **Spreading:** replicas of a component prefer different nodes (`topologySpreadConstraints`, `ScheduleAnyway`), and each has a PodDisruptionBudget so a drain keeps one.
- **Realtime scaling:** more replicas share the load through Valkey. The autoscaler scales down slowly (one pod per two minutes after ten minutes of lower load), because a
  stopped pod disconnects its clients, who reconnect to another. Scaling on connections needs the Prometheus adapter to expose
  `elysion_realtime_websocket_connections` as a pod metric; CPU alone is the default.
- **Network policies** need a network plugin that enforces them. They limit **ingress** only: Traefik (its namespace) reaches the frontend, the BFF and the realtime
  service; the business backend only the BFF and the realtime service; the monitoring namespace the three services. They work per port, not per path, so
  `/internal` of the business backend (never routed at the edge) is still protected by its secret, not by the policy. Egress is open: the external services are yours.

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
