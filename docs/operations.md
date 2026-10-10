# Operations: alerts and dashboard

What to watch when Elysion runs, and what to do when an alert fires. The metrics are those of [the gateway spec](specs/gateway.md#logs-and-metrics); the rules are in
[`infra/observability/alerts.yml`](../infra/observability/alerts.yml), with tests in `alerts.test.yml` that CI runs with `promtool`.

## Start it

For development, and as an example for an operator, an overlay adds Prometheus, Alertmanager and Grafana to the stack:

```sh
pnpm dev:observability      # or: docker compose -f docker-compose.yml -f docker-compose.observability.yml up -d
```

Grafana is at `http://localhost:3030` (the dashboard **Elysion** is provisioned; there is no login, the port is bound to the loopback interface), Prometheus at
`http://localhost:9090` (Status → Rules shows the alerts), Alertmanager at `http://localhost:9093`. Ports: `GRAFANA_PORT`, `PROMETHEUS_PORT`, `ALERTMANAGER_PORT`.
`pnpm dev:stack:down` removes it with the rest; `pnpm dev:stack` alone would remove its containers as orphans.

**Alerts go nowhere yet:** the receiver in [`alertmanager.yml`](../infra/observability/alertmanager.yml) is a placeholder. Put a webhook of your chat or an
incident tool there.

**With your own Prometheus:** scrape the jobs of [`prometheus.yml`](../infra/observability/prometheus.yml) (`traefik:8082`, `bff:3000`, `realtime:3000`,
`business-backend:8080`, all on the compose network, none routed at the edge), load `alerts.yml`, and import `dashboard.json` into Grafana (it asks for the
data source). In Kubernetes the same ports are the Services of the chart; nothing in the chart scrapes them for you. The dashboard needs the job names above.

The **backup** metric comes from a file the backup service writes (`backup.prom` next to the backups). The overlay serves it with `node-exporter`'s textfile
collector alone; with your own Prometheus, point a textfile collector at the backup directory. Without the backup service the metric does not exist and
`BackupTooOld` can never fire: that is not a healthy backup, it is no backup.

The thresholds are starting values. Change them to what your load looks like, and keep `alerts.test.yml` in step (`docker run --rm --entrypoint promtool -v
$PWD/infra/observability:/w -w /w prom/prometheus:v3.5.0 test rules alerts.test.yml`).

## Alerts

### ServiceDown

Traefik, the BFF, the realtime service or the business backend could not be scraped for 2 minutes (critical). The label `job` says which.

1. `docker compose ps` (or `kubectl get pods`): is it running, restarting?
2. Its log: `docker compose logs --tail 100 <service>`, or the log viewer ([ADR 0025](adr/0025-structured-logging-and-log-viewer.md)).
3. A dead BFF or Traefik is an outage for everybody; a dead realtime service freezes editing (clients reconnect on their own); a dead business backend stops board
   lists, sharing and saving. After a restart check `RealtimeSaveFailing`: boards that could not be saved meanwhile are saved by the retry.

### BffErrorRateHigh

More than 2 percent of the BFF's requests were answered with 5xx for 5 minutes (critical).

1. Which route? In Prometheus: `sum by (route, status_code) (rate(elysion_bff_http_requests_total{status_code=~"5.."}[5m]))`.
2. 502 is the business backend not answering: look at `ServiceDown` and `DatabaseErrors`. 500 is a bug: find the `requestId` in the BFF's log.

### BffLatencyHigh

The 95th percentile of the BFF's request duration is over 1 second for 5 minutes (warning).

1. The dashboard's "BFF request duration" and "Backend request duration p95": if the backend is slow too, the database is the next place (connections, locks, load).
2. If only one route is slow, that route's request in the log shows where the time went.

### RealtimeSaveFailing

A board's save failed at least once in the last 10 minutes (critical). The content is **not lost**: it is held in memory and saved again with a growing delay, up to
30 seconds. It is lost if the realtime service stops before a save works.

1. The realtime log says why (`Saving board … failed`): the business backend down, a database error, or a document the backend refuses (too large).
2. Do not restart the realtime service while saves fail. Fix the cause (`ServiceDown`, `DatabaseErrors`); the next retry saves.
3. The alert resolves 10 minutes after the last failure.

### RealtimeConnectionsHigh

One realtime instance holds more than 1000 WebSocket connections for 5 minutes (warning). The service has no hard limit of its own; this is a threshold to
tune to what one replica serves well. See the memory and the event loop of the process (`process_*`, `nodejs_*` in the same endpoint). More replicas share the
load: the instances relay updates over Valkey ([realtime spec](specs/realtime.md)), but one board is held by every instance that has a client on it.

### AuthRefusalsHigh

More than half of the requests that Traefik sends to the BFF's check (`/api/auth/verify`) were refused with 401 for 10 minutes (warning). Some are normal (an
expired token before the client refreshes it); a majority is not.

1. A token signed by a key the BFF does not know: Keycloak's keys changed, or the BFF's `OIDC_JWKS_URI` or `OIDC_ISSUER` is wrong (compare with the realm).
2. A client in a loop with an old token, or a script probing the API: the BFF's log names the user and request id of each refusal, never the token.

### BackupTooOld

The last good backup finished more than 36 hours ago (critical).

1. `docker compose --profile backup logs --tail 50 backup`: the last line of each run is `backup ok …` or `backup FAILED: <why>`.
2. Is the container running, is `BACKUP_CRON` right, is the disk full, can it reach Postgres and the object store?
3. Run one by hand: `docker compose --profile backup run --rm backup backup.sh`. See [Back up and restore](self-hosting.md#back-up-and-restore).

### DatabaseErrors

The business backend got more than 3 errors from Postgres in 2 minutes (critical).

1. Is Postgres up and accepting connections (`pg_isready`), and the disk not full? Is the connection limit reached?
2. The backend's log has the exception; `elysion_backend_db_commands_total{outcome="error"}` shows when it began.
3. Everything that needs the database fails with 5xx meanwhile: expect `BffErrorRateHigh` and `RealtimeSaveFailing` with it.

### CertificateExpiresSoon

A certificate Traefik serves expires in less than 14 days (warning). Traefik reports it only when it serves TLS (the demo does not), so the alert exists for
a deployment that terminates TLS in Traefik. Renew the certificate (or fix the renewal that should have happened), then check that Traefik reloaded it:
`traefik_tls_certs_not_after`.
