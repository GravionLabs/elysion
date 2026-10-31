# ADR 0032: How board snapshots are stored and restored

- Status: Accepted (2026-10-30, by the product owner, as proposed)
- Date: 2026-10-30
- Issues: #845 (Feature #843); implemented in #846 and #847
- Builds on: [ADR 0011](0011-board-document-persistence.md) (full Yjs state in Postgres), [ADR 0017](0017-internal-api-authentication.md) (internal calls), [ADR 0026](0026-board-document-compaction-and-limits.md) (compaction, the generation, the limits), [ADR 0029](0029-dot-voting-on-the-server.md) (the backend calling the realtime service)

## Context

A board has exactly one stored state: the row of `BoardDocuments` (`State`, a full `Y.encodeStateAsUpdate`, saved by the realtime
service through `PUT /internal/boards/{id}/document` at most every 10 s while it changes). Somebody who deletes half a board by
mistake, or a workshop that wants to go back to where it was an hour ago, has nothing to go back to; the nightly backup restores the
whole installation, not one board. #843 asks for named and automatic versions of a board, a history panel, a restore onto the live
board and "open as a new board".

What is already there and constrains the choice:

- The document is a `Y.Map` of element id to element JSON (`elements`), a map of files (`files`), the facilitation map `session`
  (`timer`, `comments`) and `meta.generation`. Elements are never removed, only marked `isDeleted`.
- A client that finds a new generation (close code `4409`) throws its `Y.Doc` away and **writes its scene back element by element
  where its version is higher** (ADR 0026); offline copies of another generation are discarded.
- Files live in the object store (`elysion-files`, keys `boards/{boardId}/{fileId}`), written by the business backend; the backup
  copies the bucket and dumps Postgres (`infra/backup/`).
- There is no byte quota per person: #777 counts boards and templates, not bytes.
- The audit log (`IAuditLog.Record`) commits in the same transaction as the change.

### Measurement

The stored state against the live elements as Excalidraw JSON, for boards of rectangles and text (synthetic boards with the element shape
the canvas stores, encoded with `yjs` 13.6; every element written several times, a tenth deleted):

| Elements | Writes each | Yjs state | Yjs, gzip | Live elements as JSON | JSON, gzip |
| -------: | ----------: | --------: | --------: | --------------------: | ---------: |
|      500 |           5 |   212 KiB |    18 KiB |               215 KiB |     10 KiB |
|    2,000 |           5 |   844 KiB |    62 KiB |               862 KiB |     40 KiB |
|    5,000 |          10 |   2.3 MiB |   193 KiB |               2.1 MiB |    100 KiB |
|   20,000 |           3 |   8.1 MiB |   547 KiB |               8.5 MiB |    400 KiB |

ADR 0026 measured about 373 bytes per live element after a rebuild, and 3,500 elements at 4.5 MiB before one. So: the Yjs state is
**about as big as the JSON** of its elements once it is compacted, both compress **10 to 15 times** with gzip, and the limit of 8 MiB
per document bounds one snapshot. Fifty snapshots of a board of 2,000 elements are about 3 MiB gzipped, 42 MiB raw.

## Options

**What a snapshot is.** (A) The encoded Yjs state of the board at that moment. (B) Only the live elements and the file references
as Excalidraw JSON: smaller by the deleted elements, readable by the public API (#852) without `yjs`, but without `session`.
(C) A plus a JSON preview. A restore of A or B needs the same work (the elements are what is restored); the API can decode A in
the BFF with `yjs` (ADR 0033) as it must for the live board anyway; a preview picture is rendered by the canvas from the elements
(#846), so C adds nothing that A lacks.

**Where it is stored.** (A) The bytes in a Postgres table. (B) The bytes gzipped in the object store under
`snapshots/{boardId}/{snapshotId}.yjs.gz`, the row (metadata) in Postgres. Postgres keeps everything in one transaction and one
dump, but a few hundred megabytes of rarely read blobs make every dump, restore and vacuum slower. The object store is already
backed up, already deleted with the board (`DeletePrefixAsync`, with the same small risk of an orphan when that call fails after the
commit), and costs nothing while nobody opens the history.

**How a restore works on a live board.** (A) **Replace**: build a new document from the snapshot with a new generation; every
client gets `4409` and reloads. But a client writes its scene back where its versions are higher, and every element changed since
the snapshot has a higher version on the client: the restore would be undone by the first reconnecting tab unless the rebuilt
elements also get higher versions. (B) **Merge forward**: the realtime service applies the difference as one ordinary update on
the live document: every element of the snapshot is written with its snapshot content and a version above the current one, every
element that is live now but not in the snapshot is marked `isDeleted` with a higher version. Clients stay connected and see the
board change like any edit; an offline copy that comes back brings only the changes its person made, as with any concurrent edit.
The document grows by about one snapshot of tombstones, which compaction (ADR 0026) takes back when the board is idle.
(C) **Only as a copy**: no restore onto the board, only "open as new board". Safest, but not what a workshop that broke its board
needs.

## Decision

**A snapshot is the encoded Yjs state (A), stored gzipped in the object store with a row in Postgres (B), and restored by merging
forward (B).**

- **Table** `BoardSnapshots`: `Id`, `BoardId` (cascade), `Name` (up to 120 characters, `null` for automatic ones), `Kind`
  (`Manual`, `Auto`, `BeforeRestore`), `CreatedBy` (subject, `null` for automatic), `CreatedAt`, `SizeBytes` (gzipped),
  `ElementCount`. The bytes at `snapshots/{boardId}/{id}.yjs.gz` in the board's bucket. Writing the object comes first, the row
  second; a row without its object is reported as missing, an object without a row is removed by the cleanup job.
- **Where the bytes come from**: always the stored `BoardDocuments.State`, never the client. "Save version" first asks the realtime
  service to save the board now if it is open (an internal call, so the snapshot holds the last seconds too), then copies the state.
- **Automatic snapshots**, made by the business backend, no new call from the realtime service: on `PUT .../document` when the
  board's newest snapshot is older than one hour and the state changed since (the previous stored state is snapshotted before it is
  overwritten); before a compaction rebuild (the realtime service sends `X-Elysion-Save-Reason: compaction` with that save); before
  every restore (`BeforeRestore`, named "Before restore").
- **Retention**: automatic ones 30 days and at most 50 per board (the oldest go first); named ones until deleted, at most 100 per
  board (`409` beyond). A daily background job removes expired ones. There is no byte quota to count against (#777 counts boards);
  the per-board caps and the document limit of 8 MiB bound it to at most 150 × 8 MiB raw per board, typically a few MiB gzipped.
- **Restore** (`POST /boards/{id}/snapshots/{sid}/restore`, owners): the backend makes the `BeforeRestore` snapshot, then calls the
  realtime service (`POST /internal/boards/{id}/restore` with the snapshot id, a service token as in ADR 0029). The realtime
  service loads the board if nobody has it open, reads the snapshot's bytes from the backend, applies the merge forward on
  `elements` and `files` in one transaction and saves. **`session` is not restored**: comments, the timer and a running
  presentation stay as they are now; a comment on an element that the restore deleted shows like one on a deleted element today.
  Every client gets a message "&lt;name&gt; restored the version of &lt;time&gt;" (a broadcast like the voting message). The restore is in the
  audit log (`snapshot.restored`, with the snapshot), as is deleting one (`snapshot.deleted`).
- **Open as new board**: like duplicate (M3), with the snapshot's state instead of the stored one and the name
  "&lt;board&gt; (&lt;snapshot name or time&gt;)"; read role on the source board and the board quota; snapshots are not copied with a duplicate.
- **Roles**: viewers list snapshots and open one as a new board; editors save and rename; owners restore and delete.

## Consequences

- A restore never needs a reload and cannot be undone by a reconnecting tab; the generation and `4409` stay what ADR 0026 made them.
- The object store becomes required for history (it already is for files); without it, "Save version" answers `503`.
- The backend gets two background duties (expiry, orphan cleanup) and one more internal route on the realtime service.
- Out of scope: restoring only some elements, comparing two snapshots, snapshots of a room.
