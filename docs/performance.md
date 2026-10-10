# Performance of the realtime service

How many people one Elysion installation carries, measured with the load test in [`apps/load`](../apps/load/AGENTS.md): simulated people
on boards, against the real stack with **two realtime replicas** behind Traefik, Valkey between them, and the business backend saving the
documents. Every number below is from a run you can repeat (`pnpm dev:load`, then `pnpm test:load -- --scenario <name>`).

## Method

- **A client** speaks the sync protocol the canvas speaks, moves its own element every 500 ms (what dragging one element does: one
  Yjs update per move, twice a second) and measures how old the elements of the others are when they arrive. Latency is
  **propagation latency**: from the write of the element on one client to its arrival on another, through Traefik, one replica, Valkey and
  the other replica (the two clients are usually on different replicas). One machine, one clock.
- **A run** makes the boards, ramps the clients up, writes for the time of the scenario, stops, waits 8 seconds, then reads every board four
  times through the edge (so both replicas serve a read) and checks two things: **every client's last write is in the document**, and
  **the four reads are equal**. A run that loses a write or reads different documents fails.
- **What it does not measure:** a real browser (rendering, Excalidraw), people who draw many elements (the boards here hold one element
  per client, so the documents are small: 0.6 to 3.4 KiB; the limits of [ADR 0026](adr/0026-board-document-compaction-and-limits.md) are for
  big boards), the Keycloak login (one login per run), and a network between the clients and the edge (everything is on the loopback).
- **The machine:** AMD Ryzen 7 5800H (8 cores, 16 threads), 30 GB, Docker 29.9, the stack of `main` at the release `v0.1.0-beta.158` plus
  the changes of this branch (compose with `docker-compose.load.yml`: two realtime replicas, no rate limit at the edge). The load
  generator ran on the same machine, so the numbers say what the services need, not what a separate client machine would add. CPU
  figures are `docker stats` percentages: 100 % is one core.

## Results

| Scenario                  | Clients | Boards |  p50 |   p95 |   p99 |    max | Realtime replica (CPU mean / peak, memory peak) | Traefik CPU | Valkey commands/s | Lost writes |
| ------------------------- | ------: | -----: | ---: | ----: | ----: | -----: | ----------------------------------------------- | ----------: | ----------------: | ----------: |
| `smoke` (1 min)           |      20 |      2 | 3 ms |  4 ms |  6 ms |  12 ms | 1 % / 3 %, 99 MiB                               |         1 % |                38 |           0 |
| `one-board` (5 min)       |      50 |      1 | 4 ms | 10 ms | 15 ms | 425 ms | 8 % / 11 %, 111 MiB                             |        19 % |               100 |           0 |
| `many-boards` (5 min)     |     200 |     20 | 2 ms |  6 ms |  8 ms | 504 ms | 8 % / 13 %, 156 MiB                             |        13 % |               407 |           0 |
| `reconnect-storm` (3 min) |     200 |     20 | 2 ms |  5 ms |  8 ms | 634 ms | 10 % / 23 %, 175 MiB                            |        14 % |               416 |           0 |
| `replica-kill` (3 min)    |     100 |     10 | 2 ms |  4 ms |  5 ms | 493 ms | 6 % / 13 %, 176 MiB (the survivor)              |         7 % |               203 |           0 |
| `stress` (2 min)          |     600 |     30 | 4 ms |  8 ms | 11 ms | 509 ms | 29 % / 40 %, 176 MiB                            | 69 % / 85 % |             1,257 |           0 |

Saves: 14 to 640 per run, 4 to 10 ms each (a whole document to the business backend and Postgres), none failed. Postgres and the
business backend stayed under 10 % CPU in every run.

- **The reconnect storm** (all 200 clients drop and reconnect within 5 seconds): all reconnected on the first or second try, no connection
  attempt was refused, nobody lost a write.
- **A replica killed** (`docker kill`, no clean shutdown, started again 30 seconds later): the clients of that replica reconnected to the other
  one with a new token, the 50 clients of the killed replica were closed with 1006 and reconnected (in two runs, 0 and 6 connection attempts failed before Traefik had taken the dead replica out; everybody was back within seconds), and **no client's last write was missing and the four final reads were equal**. What the dead replica had not saved yet was
  still in its clients' documents and came back with them; the updates between replicas travel through Valkey, so the survivor had them
  as well.
- The spikes in `max` (about half a second) are the moments of a save or of a reconnect; the percentiles are what people feel.

## The limits that follow

These are the numbers for **boards of the size the scenarios use**, on the machine above. Read them as orders of magnitude.

- **Connections per replica:** 300 connections each moving an element twice a second took 29 % of a core and 175 MiB per replica, and the **edge**
  (Traefik, which carries every frame of every WebSocket) took more CPU than both replicas together (69 % of a core at 600 connections). The first
  thing to scale at about 600 simultaneous editors of this kind is the edge (more Traefik replicas), not the realtime service. A person who
  only looks sends almost nothing, so a replica carries far more viewers than editors.
- **CPU:** about 1 millicore per moving connection (290 m for 300). The chart asks `250m` and scales at 70 % of it, which is about **180 connections
  per replica**; that is deliberately conservative, a replica did 300 at 40 % of a core at its peak.
- **Memory:** an idle replica holds 55 MiB; every board in memory and every connection add to that. 20 boards with 10 connections each took 150
  MiB (`many-boards`), 30 boards with 20 each 175 MiB (`stress`): **about 4 to 5 MiB per board in memory with 10 to 20 connections on it**, for
  boards of a few KiB. A board near the limit of 8 MiB takes about 8 MiB for its document and as much again while it is encoded for a save. The chart asks
  `256Mi` and limits to `512Mi`, which holds 30 small boards with 20 people each and a few large ones.
- **Valkey:** 1,257 commands per second at 600 clients (about two per client and second: the presence and the update relay), 7 MiB. Valkey is not
  the limit; it needs a password and not a size ([security review](security.md), F4).
- **Saves:** a save costs 4 to 10 ms for a small document. The save debounce (2 s, at most 10 s) keeps the number of saves at one per board per
  2 to 10 seconds however many people draw; a board of 5 MB takes longer per save (the whole state is sent).

## What to change when you exceed them

| You see                                                                 | Change                                                                                                                                                                                                    |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The p95 above 100 ms, Traefik near 100 % of a core                      | More Traefik replicas (`traefik` chart: `deployment.replicas`); give it `resources.requests.cpu` of 500m or more                                                                                          |
| Realtime replicas above 70 % CPU                                        | More replicas (`replicas.realtime`, or the autoscaler: `autoscaling.realtime.enabled`, with `connectionsTarget` of about 200 when the Prometheus adapter serves `elysion_realtime_websocket_connections`) |
| Replicas killed for memory (`OOMKilled`)                                | Raise `resources.realtime.limits.memory`; look at the biggest boards (`elysion_realtime_document_size_bytes`) and at `limits.*`                                                                           |
| Saves slow or failing (`elysion_realtime_document_save_failures_total`) | The business backend and Postgres: CPU and connections of Postgres, `resources.businessBackend`, more backend replicas                                                                                    |
| Boards that are slow to open                                            | Boards over 1 MiB: [compaction](specs/realtime.md#limits-and-compaction-adr-0026) rebuilds them when idle; the limits cap them at 8 MiB and 20,000 elements                                               |

## Repeat it

```sh
pnpm dev:load                                         # the stack with two realtime replicas and no rate limit
pnpm test:load -- --scenario smoke                    # one minute; fails above the p95 of its scenario file
pnpm test:load -- --scenario many-boards              # also: one-board, reconnect-storm, replica-kill, stress
```

The short `smoke` scenario also runs weekly in CI (`.github/workflows/load.yml`) on a hosted runner, which is slower than the machine above:
its threshold (`maxP95Ms` in `apps/load/scenarios/smoke.json`, 500 ms) is far above what it measures here (4 ms), so that it fires for a
regression and not for a slow runner. The runs of this page are the reports in `apps/load/reports/` of the day they were made.
