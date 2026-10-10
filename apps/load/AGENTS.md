# apps/load — load test of the realtime service

A Node runner (`ws`, `yjs`, `y-protocols`, TypeScript 6) that plays many people on many boards against a **running stack with two
realtime replicas** and reports how long an update takes to reach the others, what the services cost, and whether anything was lost.
Not part of `pnpm test`; the results and the limits that follow from them are in [docs/performance.md](../../docs/performance.md).

```sh
pnpm dev:load                                   # the stack with two realtime replicas and no rate limit (docker-compose.load.yml)
pnpm test:load -- --scenario smoke              # 20 clients, 1 minute; also: one-board, many-boards, reconnect-storm, replica-kill
pnpm test:load -- --scenario path/to/my.json    # your own
```

- **A scenario** is a JSON file in `scenarios/` (`src/scenario.ts` has the fields): clients, boards, how long they write, how often, a ramp
  so that the token endpoint is not asked 200 times at once, `events` (`reconnect-all` within some seconds, `kill-replica` and start it
  again later), `maxP95Ms` (the run fails above it) and `requireNoLoss` (default true).
- **A client** (`src/client.ts`) speaks the sync protocol of the canvas: it moves its own element every `writeEveryMs` (`{ writer, n, ts }`
  in the `elements` map), measures the age of the elements of the others when they arrive (one machine, one clock), reconnects with a
  growing delay and a new WS token (as the shell does), and keeps its document across reconnects. `readDocument` opens a board once and
  returns its elements.
- **The runner** (`src/run.ts`) signs in as `dev1` (`LOAD_USER`), makes the boards over the API, starts the clients, samples CPU and memory
  of the stack's containers with `docker stats` every 10 s, scrapes `/metrics` of every realtime container (`docker exec`: the port is not
  published) and Valkey's command counter, runs the events, then stops writing and reads every board four times through the edge (so
  both replicas serve reads): **a client's last write (`c<i>`.`n`) must be in the document, and the four reads must be equal.** It deletes
  the boards, writes a Markdown report to `reports/` (git-ignored; the numbers of `docs/performance.md` are copied from the runs by hand)
  and exits 1 when `maxP95Ms` is exceeded or a write is lost.
- It needs `docker` on the PATH and runs it in `COMPOSE_DIR` (default: the current directory, so run it from the repository root, or set it).
  `APP` (default `http://localhost`), `KEYCLOAK` (default `http://localhost:8081`) and `COMPOSE_PROJECT` (default `elysion`) say which stack.
- The weekly run is `.github/workflows/load.yml` (the smoke scenario; also on demand with any scenario).
- Never run it against a stack with data that matters: it makes and deletes boards of `dev1` named `load <scenario> <n>`.
