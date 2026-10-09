# ADR 0026: How board documents are compacted and limited

- Status: Proposed
- Date: 2026-10-09
- Issues: #697 (Feature #696); implemented in #698
- Builds on: [ADR 0011](0011-board-document-persistence.md) (full snapshots; compaction "out of scope until measured" and "unsafe while clients may reconnect with old copies"), [ADR 0017](0017-internal-api-authentication.md)

## Context

A board's document is one `Y.Map` of element ids to element JSON. Every change writes the whole element again, so every write leaves a
tombstone, and nothing ever shrinks the state. ADR 0011 measured about 1 KB per two seconds of dragging and kept compaction out until
somebody measured what it would win. There is also no limit: the WebSocket accepts 16 MiB per message, the business backend stores up to
32 MiB, and the canvas lets anybody draw as many elements as they like. Before real people depend on Elysion (Epic #670) a board must
not be able to grow until it is slow to open or too large to save, and it must never fail silently when it does.

What exists today (checked in the code on 2026-10-09):

- `YjsRoomRegistry` saves `Y.encodeStateAsUpdate(doc)` through `PUT /internal/boards/{id}/document`; the room is unloaded 30 s after its
  last client left (`ROOM_EVICT_AFTER_MS`), and a room loaded from the store starts from that state.
- The gateway has `maxPayload` of 16 MiB (`yjs.gateway.ts`); the backend `MaxStateBytes` is 32 MiB. The canvas has no limit on elements.
- **Images are no longer in the document** (#702): the document holds a reference per image, so the limits below are about elements.
- A client that loses its connection keeps its `Y.Doc` and reconnects with backoff (up to 30 s); a tab can also stay open for hours.

## Measurements

`apps/realtime/scripts/measure-compaction.mjs` builds boards the way ADR 0011 did (elements of about 550 bytes of JSON, a third of them with
text), moves random elements with one write per pointer move, with several clients writing in turn, and encodes the state three ways. Run
with `pnpm --filter @elysion/realtime exec node scripts/measure-compaction.mjs`:

| Scenario                                           | Elements |  Writes |   State | gzipped | A: re-encode in a fresh doc | B: rebuilt from the elements | Rebuild time |
| -------------------------------------------------- | -------: | ------: | ------: | ------: | --------------------------: | ---------------------------: | -----------: |
| Typical workshop, 20 moves each                    |      700 |  14,000 |  385 KB |   70 KB |                      385 KB |       261 KB (gzipped 30 KB) |        23 ms |
| Typical workshop, 20 minutes of dragging, 5 people |      700 |  72,000 |  866 KB |  223 KB |                      866 KB |       262 KB (gzipped 30 KB) |         8 ms |
| Large board, 100 moves each, 5 people              |    3,500 | 350,000 | 4.54 MB | 1.10 MB |                     4.54 MB |     1.28 MB (gzipped 150 KB) |        37 ms |

What this says:

- **Option A wins nothing.** Yjs already garbage-collects the content of an overwritten value (`gc` is on by default); what stays is a small
  struct per write, and re-encoding the state into a fresh document keeps every one of them, because they are the clock history that merging
  needs. The issue assumed A would drop the tombstones and keep the history; in Yjs the two are the same bytes.
- **Option B wins what there is to win:** 3.3 times on the long session (866 KB to 262 KB), 3.5 times on the large board (4.5 MB to 1.3 MB).
  The rebuilt state is about 373 bytes per live element whatever the history was, so it is the **size of the content**, and it takes tens of
  milliseconds to make.
- Without compaction the state still stays small for a long time: 20 minutes of five people dragging is under 1 MB. Compaction is housekeeping
  that keeps the stored size proportional to the board and not to its age; it is not an emergency.
- The element count is the real driver: at about 373 bytes per element, **20,000 elements are 7.5 MB**, which is where a limit of 8 MiB lands.

## Options

**A. Re-encode on save** (a fresh `Y.Doc` with `gc: true` receives the state and is encoded). Measured: no change, see above. Rejected.

**B. Snapshot and reset.** When no client is connected and the stored state is larger than a threshold, rebuild a new document from the live
elements only (new client id, new clocks) and give it a new **generation**. A client that holds an older generation must not merge into it: its
history would arrive as concurrent writes from an unknown client, and Yjs would resolve each element by client id, bringing back stale values.

**C. A on every save, B when A is not enough.** A does nothing, so C is B with extra work.

| Criterion                      | A       | B                                                                                                                |
| ------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------- |
| Size won back                  | none    | 3 to 4 times after long editing; the size of the content                                                         |
| Risk of losing an offline edit | none    | none for content (see "A client with an old copy"), a conflict is resolved per element by its version, as always |
| Code in the client             | none    | the generation, one close code and a reload of the `Y.Doc` that keeps the scene                                  |
| Code in the realtime service   | none    | the rebuild, the threshold, the generation check                                                                 |
| How it shows to clients        | nothing | a close code on the next reconnect of a client that was away during the compaction                               |

## Decision (proposed)

1. **Option B, nothing else.**
   - **When:** when the last client of a room leaves and the saved state is larger than **1 MiB**, the room, still loaded for its 30 s grace
     period, is rebuilt (the rebuild takes tens of milliseconds even for the large board) if that makes it at most **half** as large, and saved.
     It never happens while anybody is connected, so nobody's cursor, selection or undo history is touched. Smaller boards are never rebuilt:
     there is nothing to win.
   - **The generation** is a random id in a second `Y.Map` of the document, `meta`, key `generation`, written when a document is created and
     again by every rebuild. A client reads it after its first sync and sends it as `generation` in the WebSocket URL on every reconnect. The
     server compares it with the document's: equal, or none sent (a first connection), proceeds; different closes the connection with
     **close code 4409** (`WS_CLOSE_STALE_COPY`, next to 4401 and 4403 in `@elysion/shared-types`). A document without `meta` (every board
     today) is given a generation the first time it is loaded, which changes nothing for clients that never sent one.
   - **A client with an old copy** (closed with 4409) throws its `Y.Doc` away, creates a new one, and connects again. Its Excalidraw scene is
     **not** thrown away: the binding writes what the scene holds into the new document by the usual rule (an element is written when the scene's
     version is higher than the stored one), so a change made while it was away is kept, and an element that was deleted by others while it was away
     comes back only if the client had changed it later. This is the same per-element merge as today, not a new rule.
   - **No new column or endpoint**: the generation is in the document itself.
2. **Limits**, refused with a message and never silently dropped:
   - **`MAX_UPDATE_BYTES` = 2 MiB per Yjs update** (the gateway's `maxPayload` stays 16 MiB for the other messages and for the first sync step of
     a large board). An update over it is not applied; the connection is closed with the existing 1009 ("message too big") and the canvas says "That
     change is too large to send."
   - **`MAX_ELEMENTS` = 20,000 live elements**, enforced by the canvas **before** it writes: the binding does not write an element that would exceed
     it, the element is taken off the scene again, and the canvas announces `limit` ("This board is full: 20,000 elements."). It is a product limit
     (about 7.5 MB), not a security one.
   - **`MAX_DOCUMENT_BYTES` = 8 MiB** (half the gateway's `maxPayload`, a quarter of the backend's `MaxStateBytes`) as the server's backstop: when the
     encoded state of a room exceeds it, the realtime service stops applying updates and answers every update with a `board-full` message (message
     type 4 of the sync protocol, no payload) that the canvas shows as "This board is full"; the room keeps serving reads and presence and is
     compacted when it empties. A board that is still over the limit after compaction stays read-only with that message, and an owner can export it
     and make two boards. The limit exists for a client that bypasses the canvas.
   - The three are settings of the realtime service (`MAX_UPDATE_BYTES`, `MAX_DOCUMENT_BYTES`) and a constant of the canvas (`MAX_ELEMENTS`, an
     attribute later if somebody needs it). The backend's `MaxStateBytes` stays at 32 MiB: it only has to be above the realtime service's limit.
3. **Images** are references (#702); they are not counted in these sizes and the limits above do not mention them. The image limits are
   `MAX_FILE_BYTES` and `MAX_FILES_PER_BOARD` of the business backend.

## Rejected options

- **A, and C as "A first":** no gain in Yjs.
- **Compacting while clients are connected** (rebuilding and broadcasting a new document): every client would have to replace its document in
  the middle of a drag, and undo history would go with it. The measurements say a board needs it after hours of editing, not minutes.
- **Dropping the history of deleted elements in the same step** (removing `isDeleted` elements from the rebuilt document): saves a little more,
  but a client with an old copy could bring a deleted element back as alive. Deleted elements stay in the rebuild.
- **A limit in bytes only:** a user cannot act on "8 MiB"; they can act on "20,000 elements". The byte limit is the backstop.

## Consequences

- The realtime service gains the rebuild, the generation check, two limits and the `board-full` message; the canvas gains the generation on
  reconnect, the reload of its `Y.Doc` on 4409, the element limit and two messages; `@elysion/shared-types` gains `WS_CLOSE_STALE_COPY`. This is
  #698, which also writes `docs/specs/realtime.md` ("Limits") and `frontend.md`.
- **ADR 0011 is superseded in part** (compaction is no longer out of scope; its warning is answered by the generation).
- A tab that was open across a compaction reloads its document once, invisibly except for the scene flickering as it is re-applied. Tested with
  two clients, one of them offline across a rebuild.
- If a measurement later shows boards over 8 MiB that are not abuse, raise `MAX_DOCUMENT_BYTES` and the gateway's `maxPayload` together; nothing else
  depends on the numbers.
- **Owner answer (2026-10-09): 20,000 elements is fine.** It stays a constant of the canvas, to be lowered if rendering on a weak laptop turns out to need it (there is no rendering measurement yet).

## If the owner picks something else

- No compaction: the stored size grows with the writes; at the measured rates it takes many hours of dragging to reach a few MB, and the limits
  above still apply (only the 1 MiB trigger and the generation go away).
- Compaction on a schedule instead of on emptying: the same rebuild, run by a job; it needs a way to know that nobody is connected across
  instances (Valkey), which "the last client left" does not.

## Decision

_Proposed. The owner has confirmed the element limit (20,000); to be accepted by the product owner, who then removes `needs-decision` from #697._
