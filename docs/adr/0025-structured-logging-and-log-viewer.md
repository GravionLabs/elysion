# ADR 0025: Structured logs with a request id, and VictoriaLogs as the local log viewer

- Status: Accepted
- Date: 2026-10-09
- Issues: #625, #626; implemented in #627 (the three services) and #628 (the viewer), which are written for the recommended options
- Builds on: [ADR 0017](0017-internal-api-authentication.md), "Logs and metrics" in [gateway.md](../specs/gateway.md)

## Context

The BFF, the realtime service and the business backend log with their framework's default text logger (checked on 2026-10-09): Nest's console
logger in the two Node apps, ASP.NET Core's console logger in the backend. Tracing one board action means reading four containers side by side
and matching them by timestamp, and a rejected service token (a different `INTERNAL_API_SECRET` on the two sides) leaves no useful line in the
backend. There is no request id anywhere: not at the edge, not between the services. Traefik's access log is already JSON and already redacted
(no query parameters, no headers).

What this ADR decides: the logging libraries, the shape of a log line, the request id, what is never logged, and how a developer reads the logs
of the whole stack. What it does not decide: metrics and traces. They exist as metrics (`docs/specs/gateway.md`) and can get OpenTelemetry
traces later; both libraries below work with it, and the request id can then become the trace id.

Constraints: Elysion is MIT-licensed and open source; `docker compose up` on a laptop has to stay light; one stack definition in
`docker-compose.yml` (AGENTS.md); the WS token travels in the URL of `/yjs` (`?board=...&token=...`), so a logged URL is a logged credential.

## Decision

### 1. Libraries

| Service          | Library                                                                  | Why                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Business backend | **Serilog** (`Serilog.AspNetCore` 10.0.0, `Serilog.Sinks.OpenTelemetry`) | One summary line per request (`UseSerilogRequestLogging`), `LogContext` properties that every line of a request carries, JSON output whose shape we define, and a sink that speaks OTLP. `Microsoft.Extensions.Logging` alone has scopes and a JSON console formatter, but no request line with a duration and status, and enrichment is hand-made.                      |
| BFF, realtime    | **`nestjs-pino`** 5.3.1 (`pino` 10, `pino-http` 11)                      | Its peer range covers NestJS 11 and 12. `pino-http` gives the request line and `genReqId`; `redact` is built in; transports run in a worker thread, so shipping logs does not block the event loop. `pino-pretty` (a dev dependency) gives readable text in a terminal. Winston has no HTTP logger, no built-in redaction, and is slower; its flexibility is not needed. |

`nestjs-pino`'s `LoggerModule` replaces Nest's logger, so the existing `Logger` calls in the code keep working and gain the fields below.

### 2. The contract of a log line

JSON, one object per line, on stdout. In a terminal (stdout is a TTY, or `LOG_FORMAT=text`) the same fields are printed as readable text; in a
container the default is JSON (`LOG_FORMAT=json`). `LOG_LEVEL` sets the level (`info` by default, `debug` in the dev overlay).

| Field        | Meaning                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `timestamp`  | ISO 8601, UTC, milliseconds                                                                                              |
| `level`      | `trace`, `debug`, `info`, `warn`, `error`, `fatal` (lower case, the same words in all three services)                    |
| `service`    | `elysion-bff`, `elysion-realtime` or `elysion-business-backend`                                                          |
| `requestId`  | the request id (below); absent on lines outside a request (startup, a timer)                                             |
| `message`    | the text                                                                                                                 |
| `userId`     | the token's `sub`, nothing else about the person (no email, no name), once the request is authenticated                  |
| `err`        | on an error: `type`, `message` and `stack` of the exception                                                              |
| request line | the one line per finished request: `http.method`, `http.route` (the pattern, never the URL), `http.status`, `durationMs` |

Serilog's compact JSON uses other key names (`@t`, `@mt`); the backend therefore writes this shape with an expression template
(`Serilog.Expressions`) or a small formatter. In the viewer the names differ in the places the OTLP data model forces: the message is the body,
the level is the severity, the time is the record time; every other field keeps its name, so `requestId:"..."` finds the lines.

### 3. The request id

- The header is **`X-Request-Id`**. The BFF takes the value of the incoming request if it matches `^[A-Za-z0-9._-]{8,64}$` (so a client cannot
  put anything else into the logs) and creates a UUID otherwise. Traefik adds none: it has no generator, and the requests that never reach the BFF
  (the static frontend) have nothing to correlate.
- The BFF puts the id on every outgoing call to the business backend (one place: `apps/bff/src/boards/business-backend.client.ts`), on its
  own response, and in the logs of the request. The backend takes the header, creates an id if it is missing (a call that did not come through the
  BFF), echoes it in its response and puts it in the `LogContext`.
- The realtime service creates an id per WebSocket connection when the upgrade request has none (`handleConnection(client, request)` in
  `yjs.gateway.ts` has the request), logs with it for the life of the connection, and sends it as `X-Request-Id` on its calls to the internal
  document API ([ADR 0017](0017-internal-api-authentication.md)), so a save that fails in the backend can be followed to the connection.
- The edge's CORS middleware lists `X-Request-Id` in `accessControlExposeHeaders`, so a browser's error report can quote it.
- A request id is not a secret and not an identity; it is a correlation key and is not used for anything but logs.

### 4. What is never logged

`Authorization`, `Cookie`, `Set-Cookie`, the `token` query parameter of `/yjs`, and every configured secret (`WS_TOKEN_SECRET`,
`INTERNAL_API_SECRET`, the connection strings, the OIDC client secret), in all three services.

- Node: `pino`'s `redact` for the header paths, a `req` serializer that logs the path without the query string (the same rule as Traefik's access
  log), and a startup line that names the configuration keys and never their values.
- Backend: the request logging logs `RequestPath` and never the query string; no `Authorization` header is enriched; a destructuring policy
  keeps option objects out of the log.
- **A test per service** sends a request with `Authorization`, `Cookie` and `?token=` carrying marker strings and asserts that the captured
  output contains none of them. This test is part of #627's acceptance criteria and is what keeps the rule true.
- A rejected token logs the **reason** (expired, wrong audience, wrong signature, wrong scheme) and the scheme that failed, at `warn`, never the token.

### 5. The local log viewer: VictoriaLogs

Candidates, measured on 2026-10-09 on a Linux machine with Docker 29 (idle: the container had been up for at least 60 seconds with no logs
sent; ingest raises the numbers, none of the candidates was loaded):

| Candidate                           | License                               | Containers | Image size     | Idle memory  | Logs in                                             | Notes                                                                                                               |
| ----------------------------------- | ------------------------------------- | ---------- | -------------- | ------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **VictoriaLogs** 1.53.0             | Apache-2.0                            | 1          | 44 MB          | 3 MiB        | OTLP/HTTP (protobuf only), Loki, syslog, JSON       | Built-in web UI, query language LogsQL; stream fields must be set (below)                                           |
| Grafana Loki 3.7.8 + Grafana 13.2.3 | AGPL-3.0 (both)                       | 2          | 210 + 1,936 MB | 42 + 287 MiB | OTLP/HTTP at `/otlp` (needs structured metadata)    | The most familiar UI; the heaviest; Grafana is the natural home of dashboards later                                 |
| OpenObserve 1.0.4                   | AGPL-3.0                              | 1          | 582 MB         | 229 MiB      | OTLP/HTTP at `/api/<org>/v1/logs`, basic auth       | Logs, metrics and traces in one; needs a root user and password at start                                            |
| Seq 2026.1                          | proprietary; free for one user, 50 GB | 1          | 901 MB         | 79 MiB       | OTLP/HTTP at `/ingest/otlp/v1/logs` (protobuf only) | The best developer UI for .NET; the container needs `ACCEPT_EULA=Y` and a first-run authentication setting to start |
| Dozzle (no ingest, tails Docker)    | MIT                                   | 1          | 99 MB          | 17 MiB       | none: reads the containers' stdout                  | Keeps no history and shows no field of a JSON line as a column; a fallback, not a viewer for following a request    |

Decision: **VictoriaLogs**, as a service of `docker-compose.yml` in a compose profile `logs` (so `docker compose up` and `pnpm demo` do not
start it), with its host port in `docker-compose.dev.yml`, started by `pnpm dev:logs` and part of `pnpm dev:stack` only when asked.

- **Why not in the dev overlay only:** AGENTS.md says there is one stack definition and a new service goes into `docker-compose.yml`; a profile
  keeps that rule and keeps the default stack unchanged. The services ship nothing unless an endpoint is configured.
- **Why this one:** it is the only candidate that is both Apache-2.0 and small enough to be forgotten about (3 MiB idle, a 44 MB image, one
  container, a UI included). Seq is the best viewer for .NET and is excluded by its license: an open-source repository cannot put a
  single-user product into its shared compose file, and `ACCEPT_EULA=Y` in that file would accept a license on behalf of every contributor.
  Loki and Grafana are two containers and about 330 MiB before the first line, and OpenObserve is 230 MiB, both AGPL (acceptable for an
  unmodified separate dev tool next to an MIT project, but a reason not to prefer them). Dozzle cannot answer "show me everything with this
  request id".
- **Shipping:** OTLP over HTTP, protobuf, to `/insert/opentelemetry/v1/logs`. VictoriaLogs refuses OTLP as JSON (checked: HTTP 400,
  "json encoding isn't supported for opentelemetry format. Use protobuf encoding") and Seq documents the same limit, so the exporters are set to `http/protobuf`. Verified with the
  versions this ADR names: `Serilog.Sinks.OpenTelemetry` 4.2.0 with `Protocol = HttpProtobuf`, and `pino` 10 with
  `pino-opentelemetry-transport` 4.0.2 with `protocol: 'http/protobuf'`; both deliver a line whose `requestId` is searchable.
- **Stream fields:** every sender sends the header `VL-Stream-Fields: service.name`. Without it the resource attributes the SDKs detect (host id, process
  command line, ...) become the stream key (measured: 995 characters per line), which defeats the viewer's storage model.
- **Off by default:** the exporter exists only when `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` is set; stdout is always written. `scripts/setup-dev-env.mjs`
  may write the URL into the `.env` files; the compose file sets it for the apps in the `logs` profile.
- **Traefik's access log:** Traefik 3.7 can export it over OTLP (`experimental.otlpLogs`, `accesslog.otlp.http.endpoint`, `dualOutput` keeps
  stdout). It is marked experimental in Traefik's documentation. #628 tries it first and falls back to a small collector (Vector or the
  OpenTelemetry Collector) that reads the container's stdout if it does not work with the pinned image.
- **Retention and limits:** `-retentionPeriod=7d`, a named volume, a memory limit of 256 MB, the image pinned (`victoriametrics/victoria-logs:v1.53.0`).
- **The way out is a URL:** the apps speak plain OTLP, so replacing the viewer by Loki, OpenObserve or Seq is a change of endpoint and headers,
  not of code. That is also why the viewer is not part of the contract in section 2.

## Consequences

- Three new dependencies in the backend (Serilog packages, in `Directory.Packages.props`) and two in each Node app (`nestjs-pino` and its
  `pino` peers; `pino-pretty` and `pino-opentelemetry-transport` as dev and optional dependencies). Renovate groups them
  ([ADR 0024](0024-renovate-for-dependency-updates.md)).
- The default Nest and ASP.NET Core request lines disappear, replaced by one request line per service. Anything that greps the old text format
  (scripts, the docs) has to be updated in #627.
- The viewer's field names differ slightly from stdout's (message, level, time); documented in `docs/specs/gateway.md`.
- VictoriaLogs' UI is simpler than Grafana's or Seq's, and its query language (LogsQL) is new to most people; the spec gets three example
  queries (by `requestId`, by `service` and level, by `userId`).
- No log reaches the viewer from the Helm chart: the chart's operator ships stdout the way their cluster does. Only the JSON on stdout is a contract.
- Request ids make a support conversation possible ("send me the `X-Request-Id` of the failing call"), and they appear in the audit log of a later PBI.

## Checks

```sh
pnpm dev:logs                                   # VictoriaLogs on http://localhost:9428/select/vmui
curl -s localhost:9428/select/logsql/query -d 'query=requestId:"<id>"'
```

## Decision

Accepted by the product owner on 2026-10-09: **VictoriaLogs as the local log viewer**, "if it works"; it does (section 5 lists what was tried
against a running 1.53.0), and the libraries, the log line, the request id and the redaction rules are implemented as recommended above. #627 and
#628 are implemented as written.

## Implementation notes

What #627 and #628 did differently from, or in addition to, the text above (the decisions stand):

- **One package for the Node services.** The BFF and the realtime service get their pino options from `packages/node-logging` (`@elysion/node-logging`), so the line, the request id rules and the redaction paths cannot drift between them.
- **The Node services ship with their own OTLP stream, not `pino-opentelemetry-transport`.** That transport reads pino's numeric `level`, `msg` and `time`; the contract of section 2 replaces them (`level` as a word, `message`, `timestamp`), so its severity and time would have been wrong. `createOtlpStream` maps the contract's line onto an OTLP record (body, severity, time, dotted attributes) with the OpenTelemetry exporter, loaded only when `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` is set. It is protobuf, as section 5 requires, and was run against VictoriaLogs 1.53.0.
- **`pnpm dev:logs`, not `pnpm dev:stack`, starts the viewer.** The stack and `pnpm demo` stay exactly as they were; `dev:logs` is the stack plus the `logs` profile, with `LOGS_OTLP_ENDPOINT` set for the three services.
- **Traefik's static configuration has one source.** Its OTLP export (experimental, as section 5 says) cannot be switched on by an environment variable next to the configuration file, so `dev:logs` writes a generated copy of `traefik.yml` with the export inserted at a marker line and mounts that. It worked in the end-to-end run; the collector fallback was not needed.
- **No health check for the viewer.** Its image holds one binary, without a shell or `wget`.
- **`level` is an attribute.** The OpenTelemetry sink writes Serilog's names (`Warning`) as the severity text, so every component also sends `level` (`warn`) and `level:warn` finds all of them.
- **Checked on a real stack** (a second compose project next to a running one, with a token from the running Keycloak): one `X-Request-Id` found the BFF's forwardAuth call, its `/api/boards` line and the backend's line; a WebSocket connection's id found the realtime service's lines and the backend's internal-API line; the access log arrived without its query string; the WS token appeared nowhere, in the viewer or on Traefik's stdout.
