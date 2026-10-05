# Realtime backend spec (NestJS, TypeScript 6)

## Owner

Backend

## Responsibilities

WebSocket gateway for Yjs CRDT sync, Redis-backed presence service, JWT validation at handshake, horizontal scaling via Redis. See ADR 0002.

## Protocol

- `YjsGateway` (`src/yjs/`) speaks the standard Yjs sync sub-protocol (`y-protocols/sync`) over a raw WebSocket at a fixed path, `/yjs`. The board id is **not** a path segment — `@nestjs/platform-ws`'s `WsAdapter` routes an upgrade to a gateway by exact pathname match, with no wildcard/pattern support, so a dynamic per-board path isn't possible without a custom adapter. Instead, the board id travels as a query parameter: `ws://<host>/yjs?board=<board-id>`.
- One `Y.Doc` per board id, held in memory (`YjsRoomRegistry`) and persisted through the business backend (see Persistence); there is no cross-instance _doc content_ broadcast yet. Horizontal scaling for doc updates (Redis-backed doc broadcast across instances) is a follow-up, not yet scoped to an issue — presence (below) already solves the analogous problem for awareness state.
- WS handshake auth (JWT/short-lived token validation) is not implemented yet — see Feature #18.

## Persistence

Board documents survive a restart ([ADR 0011](../adr/0011-board-document-persistence.md)).

- The business backend stores one full Yjs snapshot per board (table `BoardDocuments`, `bytea`, with a version) behind `GET/PUT/DELETE /internal/boards/{id}/document` (minimal API endpoints in `Endpoints/BoardDocumentEndpoints.cs`). `PUT` needs `If-Match: "<version>"`, or `If-None-Match: *` for the first save; a stale version answers `409` with the stored state, no precondition `428`. The route is not exposed at the edge. Deleting a board (`DELETE /boards/{id}`) deletes its document; the document table has no foreign key to `Boards`, because ids such as `default` have no board row.
- Realtime reaches it through the `DocumentStore` interface (`src/persistence/`: `load`, `save`, `delete`); `HttpDocumentStore` is the implementation, configured with `BUSINESS_BACKEND_URL` (default `http://localhost:5174`).
- `YjsRoomRegistry.getOrLoad` loads a room's stored state before the first sync step is answered; connections arriving during the load are queued, and concurrent first connections share one load. **If the load fails the connection is closed with code 1011** (`Board could not be loaded`): an empty board is never served in place of an unloaded one, because the next save would overwrite the real content.
- A changed room is saved 2 s after its last change (at the latest 10 s after the first unsaved change), when its last client leaves, and when the process stops (`enableShutdownHooks`). A save names the version it is based on. If another instance saved first (`409`), realtime merges the stored state in with `Y.applyUpdate` and saves the union. A failed save is retried after 1 s, doubling up to 30 s, and logged as an error; the room stays in memory meanwhile. An unchanged room is never saved.
- Rooms are not unloaded yet (#279), and updates are not relayed between instances (#274); until then two instances serving one board converge only through the store (on conflict).
- Sizes: the state is about the size of the live elements' JSON (a typical board is a few hundred KB, a large one a few MB) and grows by about 1 KB per two seconds of dragging because of Yjs tombstones; see the ADR for the measurements.
- A room that is open when its board is deleted can save its document again. Such orphans are not swept yet.

## Presence

Cursor/avatar presence (Yjs awareness, message type 1) is broadcast cross-instance via Redis pub/sub (`PresenceRelay`, `src/presence/`), not just to other clients on the same `realtime` process:

- `YjsRoomRegistry` creates one `y-protocols/awareness` `Awareness` object per room (alongside its `Y.Doc`) and applies every incoming awareness update to it via `applyAwarenessUpdate`.
- `YjsGateway` relays each incoming awareness message to local clients in-memory (as before) **and** publishes it to a Redis channel keyed by board id (`PresenceRelay.publish`); every instance holding that room subscribes to the same channel and relays what it receives to its own local clients. Each publish is tagged with a per-process instance id so an instance ignores its own message coming back off the subscription.
- A client that joins is caught up without a gap: `YjsGateway` first subscribes to the board's presence channel and waits until the subscription is active (`PresenceRelay.subscribe` resolves for every caller only then, also for a connection that arrives while the first one is still subscribing), and only then reads the snapshot. An announcement is recorded in the hash before it is published, so one published before the subscription is in the snapshot and one published after reaches the subscription.
- `YjsRoomRegistry`'s `Awareness.on('update', ...)` listener persists every changed client's state to a Redis hash keyed by board id (`PresenceRelay.recordState`/`removeState`), independent of pub/sub — this is what makes a **snapshot** possible: a newly-connecting client (on any instance, including one that has never seen this board before) is sent every other client's current state (`PresenceRelay.snapshot` → `YjsGateway.sendPresenceSnapshot`), mirroring the sync-step-1-on-connect pattern already used for doc state.
- Valkey is the machine-wide instance from `local-infra`, shared with other projects, so channels and keys are namespaced: `elysion:presence:<boardId>` (pub/sub) and `elysion:presence:state:<boardId>` (hash).
- All Redis calls from the gateway/registry are fire-and-forget with a logged warning on failure — a Redis outage degrades presence to same-instance-only, it doesn't drop WS connections or doc sync.
- A client's presence ends when its socket does, whatever the reason (clean close, network drop, killed browser): `YjsRoomRegistry` remembers which awareness client ids each socket announced, and `YjsGateway.handleDisconnect` removes them from the room's `Awareness`, which deletes them from Valkey, then sends the removal to the local clients and publishes it so clients on other instances drop the collaborator too.
- Entries left behind by an instance that crashed expire: each hash entry is stored as `<written-at-ms>:<base64 update>`, a client's every announcement (about every 15 s) rewrites it, and `snapshot` deletes and skips entries older than 30 s (`PRESENCE_ENTRY_TTL_MS`, the Awareness `outdatedTimeout`) as well as entries without a timestamp (the format before this rule). The whole hash also expires after 24 hours without a write, so keys of tests and deleted boards do not pile up in the shared Valkey.

## Open questions

- Short-lived WS-token issuance flow (BFF vs gateway).
- How doc updates get broadcast across multiple `realtime` instances once this needs to scale horizontally (Redis pub/sub, most likely — see `PresenceRelay` for the now-solved analogous case for presence).
