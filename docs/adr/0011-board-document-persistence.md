# ADR 0011: Board document persistence

- Status: accepted
- Date: 2026-10-05
- Issues: #98, #266, #267, #268
- Superseded in part by [ADR 0026](0026-board-document-compaction-and-limits.md) (compaction and limits; Proposed)
- Builds on: [ADR 0003](0003-net10-business-backend.md), [ADR 0006](0006-shared-local-infrastructure.md), [ADR 0007](0007-rustfs-replaces-minio.md)

## Context

`YjsRoomRegistry` holds one `Y.Doc` per board in memory for the life of the process and never writes it
anywhere. Restarting `apps/realtime`, including a routine deploy, silently destroys the content of every
board. This is the largest functional gap in the product (Feature #98), and three later pieces depend on its
answer: relaying document updates between realtime instances (#99), unloading idle rooms (#100), and
deleting or duplicating a board with its content (#102).

What exists today:

- A scene is one `Y.Map` named `elements` that maps an element id to the whole Excalidraw element as a plain
  JSON value. Every change to an element writes the whole element again; deleted elements stay as soft
  deletes. Yjs keeps a small tombstone for every replaced value.
- Postgres runs in the dev stack and is owned by the business backend (EF Core migrations). RustFS, an
  S3-compatible store, is provisioned (ADR 0007) but nothing uses it. Valkey is shared with other projects
  and must not hold data that has to survive (ADR 0006).
- `apps/realtime` has no database access and no knowledge of the business backend.

## Measurements

A board is a map of element ids to JSON. These numbers come from a throwaway test that builds boards of
sticky notes (a rectangle plus its text) and arrows with the app's own factories, writes them into a `Y.Doc`
the way `ExcalidrawYjsBinding` does, and then moves every element repeatedly (each move writes the element
again, as a drag does). Sizes are `Y.encodeStateAsUpdate(doc)`, the full state a new client or a restart
needs:

| Board                       | Elements | Elements as JSON | State when created | State after 20 moves each | Same, gzipped | All updates sent (the log) |
| --------------------------- | -------: | ---------------: | -----------------: | ------------------------: | ------------: | -------------------------: |
| Small workshop              |       70 |            39 KB |            33.5 KB |                   45.7 KB |        7.5 KB |                     0.7 MB |
| Typical workshop            |      700 |           386 KB |           334.7 KB |                  457.6 KB |       67.5 KB |                     6.7 MB |
| Large board                 |    3,500 |           1.9 MB |             1.7 MB |                    2.3 MB |        322 KB |                    33.5 MB |
| Large board, 100 moves each |    3,500 |           1.9 MB |             1.7 MB |                    5.1 MB |        735 KB |                     161 MB |

What this says:

- The state is about the size of the JSON of the live elements and compresses to a sixth of it. A typical board
  is a few hundred KB; even a large one is a few MB.
- Replaced values leave a tombstone of roughly 10 bytes. Dragging an element for two seconds (about 120
  writes) adds about 1 KB, so the state grows slowly with use and never shrinks (the last row is an extreme
  case: 350,000 tombstones).
- An update log grows with every write: 20 moves of a typical board is already 6.7 MB, more than ten times the
  state. Replaying or compacting a log is the cost of choosing one.

Whatever stores the state has to handle blobs of up to a few MB, written at most every few seconds per active
board.

## Options

**A. The business backend stores snapshots behind an `/internal` API.** The state goes into a table in
Postgres (`BoardDocuments`: board id, `bytea` state, version, updated-at), written and read through
`GET/PUT/DELETE /internal/boards/{id}/document`. Realtime calls it over HTTP.

**B. Realtime writes straight to Postgres.** The realtime service gets a Postgres client and its own table,
either the same snapshot or an append-only log of updates.

**C. Realtime writes snapshots to the S3 store.** One object per board (`boards/<id>.ydoc`) in RustFS,
versioned by the object store.

| Criterion                                       | A: backend API + Postgres                                                                               | B: realtime to Postgres                                                         | C: realtime to S3                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Who owns the data                               | The backend owns the database, as in ADR 0003; one schema owner (EF Core).                              | Two services write to one database; the schema needs a second migration path.   | A third place for board data besides the `Boards` table.                        |
| Delete and duplicate a board                    | One transaction in the backend; no orphan can survive a failed delete.                                  | The backend would have to reach into a table it does not own, or call realtime. | Two systems to keep consistent (row in Postgres, object in S3).                 |
| Write load                                      | Debounced HTTP `PUT` of the whole state, 100 KB to a few MB, gzip possible.                             | The same write without the HTTP hop.                                            | The same write to object storage, cheap per GB.                                 |
| Loading after a restart or on a second instance | `GET` before the first sync step answers; adds one internal call per room.                              | One query per room.                                                             | One object read per room.                                                       |
| Concurrent writers (#99)                        | A version column gives optimistic concurrency, so a stale instance cannot overwrite a newer state.      | Needs the same version column, written by realtime.                             | S3 conditional writes (`If-Match`) exist but RustFS support has to be verified. |
| Backups                                         | Covered by the database backup that has to exist anyway.                                                | The same.                                                                       | A second backup and restore procedure.                                          |
| Dev stack and CI                                | Postgres already runs; one new table and migration.                                                     | Postgres runs; realtime gets a driver and migrations.                           | RustFS runs but is a stand-in (ADR 0007); production S3 is not decided.         |
| Failure modes                                   | Backend down: rooms cannot load or save; handled by retrying and by refusing to serve an unloaded room. | Database down: the same.                                                        | Object store down: the same.                                                    |
| New code and dependencies                       | A controller and a table in the backend; an HTTP client in realtime.                                    | A Postgres client, connection pool and schema management in realtime.           | An S3 client in realtime.                                                       |

Snapshot or update log, for any of the options:

- **Full snapshot** (`encodeStateAsUpdate`, rewritten after changes): simple, one row per board, merging
  after a conflict is a single `Y.applyUpdate`. Cost: each save rewrites the whole state (sizes above), which
  debouncing keeps modest.
- **Update log plus compaction**: small writes, but the log is many times larger than the state (table above),
  needs a compaction job, and loading means replaying. It pays off only when single writes are very frequent
  and the state is very large, which the measurements do not show.

## Decision (proposed)

1. **Option A: the business backend stores the document; realtime talks to it over the internal API.**
   It keeps one owner and one migration path for the database, and makes "delete" and "duplicate" an
   operation on data the backend owns. The extra hop is acceptable at the measured sizes.
2. **Full snapshots, no update log.** One row per board in `BoardDocuments` (kept apart from `Boards` so board
   lists never read the blob). Compaction of tombstones is out of scope until a measurement shows it matters;
   see "Consequences".
3. **Saving:** realtime saves a room's state a few seconds after the last change (debounce, with a maximum
   wait) and once when the last client leaves. A failed save is retried with backoff and logged; the room
   stays in memory meanwhile.
4. **Loading, failing closed:** a room loads its stored state before the first sync step is answered. If the
   load fails, the connection is closed with a clear reason; the service must never serve an empty board in
   place of an unloaded one, because the next save would overwrite the real content.
5. **Concurrency:** every stored state has a version. `PUT` sends the version it was based on; if the stored
   version moved on (another instance saved), the backend answers `409` with the current state, realtime
   merges it into its document with `Y.applyUpdate` (merging is commutative and idempotent) and saves again.
6. **Internal API:** `GET /internal/boards/{id}/document` (`200` with the state and an `ETag` holding the
   version, `404` for a board without a document yet), `PUT` (with `If-Match`, or `If-None-Match: *` for the
   first save) and `DELETE`. The route is not exposed at the edge (docs/specs/gateway.md); authenticating
   service-to-service calls comes with the identity epic.
7. **No foreign key to `Boards`.** Ids such as `default` and boards created before this change have no row,
   and realtime must keep working for them. `DELETE /boards/{id}` removes the document; orphans can be swept
   later.

## Rejected options

- **B (realtime writes to Postgres):** removes one HTTP hop at the price of two services sharing a schema and
  a second migration system. The saving is small at these sizes.
- **C (S3 snapshots):** attractive for very large blobs, but it splits a board across two stores, needs a
  second backup path, and its production form is undecided. It stays a candidate if boards outgrow Postgres
  (tens of MB); the realtime service would only change the implementation behind the document store
  interface.
- **Update log plus compaction:** the log is ten times larger than the state for ordinary editing and brings
  a compaction job with it; snapshots meet the need.

## Consequences

- The backend gains a table, a migration, three internal endpoints and tests; realtime gains a document store
  interface with an HTTP implementation and a new setting for the backend's URL (`BUSINESS_BACKEND_URL`).
  Realtime now depends on the backend being up to open a board; it logs an error and closes the connection
  (code 1011) for every board it cannot load.
- Tombstones make the state grow with editing. A drag adds about 1 KB, so a long-lived board stays in the low
  megabytes. Compaction is not safe to do casually: a rebuilt document has new item ids, and a client that
  reconnects with an older copy would merge its history into it. If it is ever needed, it has to happen while
  no client holds the room and must be designed together with how clients reconnect.
- The first save of a room without a stored document uses `If-None-Match: *`, so two instances starting the
  same new board at once do not overwrite each other; the loser merges.
- Cross-instance relay of updates (#99) and unloading idle rooms (#100) build on the same document store.
- The decision can change later without rework outside the store implementation, because everything else
  talks to the `load`, `save` and `delete` interface.

## Owner decision

Accepted by the product owner on 2026-10-05:

1. Persistence **in the business backend** (A), not in realtime (B) or object storage (C).
2. **Full snapshots** in Postgres, without an update log and without compaction for now.
3. **Failing closed** when a room cannot load its state (users see an error instead of an empty board).

#269 implements this.
