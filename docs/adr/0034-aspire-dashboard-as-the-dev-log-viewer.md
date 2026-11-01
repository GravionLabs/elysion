# ADR 0034: The standalone Aspire dashboard replaces VictoriaLogs as the dev log viewer

- Status: Accepted (2026-11-01, by the product owner in the delivery session: no Aspire AppHost, the standalone dashboard instead)
- Date: 2026-11-01
- Issues: #889; replaces #867 (an Aspire AppHost for local development, closed)
- Supersedes: the log viewer of [ADR 0025](0025-structured-logging-and-log-viewer.md) (section 5 and its checks); the rest of ADR 0025 (the
  libraries, the log line, the request id, what is never logged) stands

## Context

[ADR 0025](0025-structured-logging-and-log-viewer.md) made VictoriaLogs the log viewer of the dev stack: `pnpm dev:logs` starts it in the
`logs` profile of `docker-compose.yml`, and the BFF, the realtime service, the business backend and Traefik send their log lines to it over
OTLP/HTTP. It works, but its UI is a query box: following a request means writing LogsQL, and the field names differ from the log line
(`_msg`, `_time`). Every sender also has to send a VictoriaLogs-specific header (`VL-Stream-Fields`) or the viewer's storage degrades.

#867 proposed an Aspire AppHost: a .NET project that starts the whole stack and shows it in the Aspire dashboard. It would have been a second
way to describe the stack next to `docker-compose.yml`, which [ADR 0023](0023-own-valkey-one-compose-file.md) rules out (one stack
definition), and it would have made the .NET SDK a requirement for running the Node apps. The owner decided against it on 2026-11-01 and for
the part of it that is wanted: the dashboard.

The Aspire dashboard also ships as a container of its own (`mcr.microsoft.com/dotnet/aspire-dashboard`, MIT), without an AppHost: it takes
OTLP and shows structured logs, traces and metrics per resource (`service.name`), with a filter on any attribute.

## Decision

The **standalone Aspire dashboard** is the log viewer of the dev stack, in place of VictoriaLogs.

- **Compose:** a service `aspire-dashboard` in the `logs` profile of `docker-compose.yml` (so `docker compose up` and `pnpm demo` do not
  start it), the image pinned (`mcr.microsoft.com/dotnet/aspire-dashboard:13.6.2`; Renovate moves the tag), a memory limit of 512 MB.
  `docker-compose.dev.yml` publishes the UI (18888, `ASPIRE_DASHBOARD_PORT`) and the OTLP/HTTP endpoint (18890, `ASPIRE_DASHBOARD_OTLP_PORT`)
  on 127.0.0.1 only. The `victorialogs` service and its volume are gone.
- **Anonymous access** (`ASPIRE_DASHBOARD_UNSECURED_ALLOW_ANONYMOUS=true`): no login token for the UI, no API key for OTLP and the
  dashboard's telemetry API. Acceptable because the service is dev-only (a compose profile, never in the Helm chart), its ports are on the
  loopback only, and what it holds is the dev stack's own logs, which by ADR 0025 section 4 hold no token, header or secret.
- **Shipping:** `pnpm dev:logs` sets `LOGS_OTLP_ENDPOINT` to `http://aspire-dashboard:18890/v1/logs` (OTLP/HTTP) for the three services, and
  Traefik's generated static configuration (`scripts/traefik-logs-config.mjs`) exports its access log over **OTLP/gRPC** to
  `aspire-dashboard:18889` (`insecure`, plain gRPC on the compose network). Apps run on the host use `http://localhost:18890/v1/logs`
  (commented in their `.env.example`); the gRPC port is not published. The `VL-Stream-Fields` header is removed from all four senders.
- **Encoding** (checked against 13.6.2): the dashboard's OTLP/HTTP endpoint takes protobuf and JSON (both answer 200 and the record shows),
  but not a gzip-compressed body: it fails with "Protocol message contained a tag with an invalid wire type". The three services send
  uncompressed protobuf (`@opentelemetry/exporter-logs-otlp-proto`, Serilog's `HttpProtobuf`), the encoding every OTLP viewer accepts, so
  the way out stays a URL, as ADR 0025 says. Traefik's OTLP/HTTP log exporter always sends `Content-Encoding: gzip` and has no setting
  for it (Traefik 3.7.13), so Traefik uses gRPC, which the dashboard takes.
- **Traefik and the request id:** Traefik's access log arrives as its JSON line in the record's message, without attributes, and it never had
  a request id. To find a request in all four components, the access log keeps one header, `X-Request-Id` (`request_X-Request-Id` when
  the client sent one, `downstream_X-Request-Id` from the BFF's answer), on stdout as in the dashboard; every other header stays dropped.
  A request id is a correlation key and not a secret (ADR 0025, section 3), so this does not weaken section 4 of ADR 0025.
- **Following a request:** each component is a resource of its own (`elysion-bff`, `elysion-realtime`, `elysion-business-backend`,
  `elysion-traefik`); the structured logs page filters the three services on the attribute `requestId`, and its text search for the id
  also finds Traefik's line. The dashboard's telemetry API
  (`/api/telemetry/logs`) gives the same records as OTLP JSON, which is what the check below uses.
- **Retention:** in memory, the dashboard's limits (10,000 log records by default); a restart of the container empties it. A dev viewer
  needs no history across restarts, so there is no volume.
- **Unreachable dashboard:** nothing changes. A service whose viewer is down drops its lines, never fails; a test of
  `packages/node-logging` keeps that true for the Node services.

## Consequences

- A better UI for following a request (a resource list, filters on attributes, a trace view the day the services send traces), and no query
  language to learn. The field names are the log line's own, without VictoriaLogs' `_msg` and `_time`.
- The image is larger (161 MB instead of 44 MB) and takes about 80 MiB idle instead of 3 MiB; it starts only with `pnpm dev:logs`.
- Logs do not survive a restart of the dashboard (VictoriaLogs kept seven days).
- The services ship the same OTLP as before; only URLs, a header and the compose service changed. Replacing the viewer again is still a
  change of endpoint.
- No AppHost: `docker-compose.yml` stays the one stack definition, and the Node apps need no .NET SDK.

## Checks

```sh
pnpm dev:logs                                     # prints http://localhost:18888/structuredlogs
t="$(curl -s localhost:8081/realms/elysion/protocol/openid-connect/token -d grant_type=password -d client_id=elysion-frontend \
  -d username=dev1 -d password=dev1 | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)"
curl -s -o /dev/null -H "Authorization: Bearer $t" -H 'X-Request-Id: check-12345678' localhost/api/boards
curl -s localhost:18888/api/telemetry/resources   # elysion-bff, -business-backend, -realtime, -traefik
curl -s localhost:18888/api/telemetry/logs | grep -o 'check-12345678' | wc -l
```

Checked on 2026-11-01 with `pnpm dev:logs`: one `X-Request-Id`, sent on the API calls that make a board and its realtime token and on the
WebSocket upgrade of `/yjs`, was found in the lines of all four resources (as the `requestId` attribute of the BFF's, the backend's and
the realtime service's lines, in the message of Traefik's), and the WS token in none.
