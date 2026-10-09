# Realtime backend spec (NestJS, TypeScript 6)

## Owner

Backend

## Responsibilities

WebSocket gateway for Yjs CRDT sync, Redis-backed presence service, JWT validation at handshake, horizontal scaling via Redis. See ADR 0002.

## Protocol

- `YjsGateway` (`src/yjs/`) speaks the standard Yjs sync sub-protocol (`y-protocols/sync`) over a raw WebSocket at a fixed path, `/yjs`. The board id is **not** a path segment — `@nestjs/platform-ws`'s `WsAdapter` routes an upgrade to a gateway by exact pathname match, with no wildcard/pattern support, so a dynamic per-board path isn't possible without a custom adapter. Instead, the board id travels as a query parameter: `ws://<host>/yjs?board=<board-id>`.
- One `Y.Doc` per board id, held in memory (`YjsRoomRegistry`) and persisted through the business backend (see Persistence); document updates are relayed between instances through Valkey (see Document relay). Horizontal scaling for doc updates (Redis-backed doc broadcast across instances) is a follow-up, not yet scoped to an issue — presence (below) already solves the analogous problem for awareness state.
- WS handshake auth: every connection needs a WS token for its board (see Authentication below).

## Authentication to the business backend

Every call to the document API carries `Authorization: Bearer <service token>` ([ADR 0017](../adr/0017-internal-api-authentication.md)): `InternalTokenSigner` signs a JWT locally (HS256 with `INTERNAL_API_SECRET`, issuer `elysion-realtime`, audience `elysion-backend-internal`, valid for 60 seconds, a new one for each call), so there is no call to anybody to get it and persistence does not depend on Keycloak. The service does not start without `INTERNAL_API_SECRET` (at least 32 characters, and not the value of `WS_TOKEN_SECRET`: one leaked secret must not forge both kinds of token). A 401 from the backend (a different secret on the two sides) is a failed call like any other: the board is not loaded, saves are retried, and the logs say `Document store answered 401`.

## Authentication

`?board=<id>&token=<ws token>`: the token is the board-scoped credential the BFF issues ([identity.md](identity.md), `POST /api/realtime/token`). `src/auth/WsTokenVerifier` checks it **locally**: HS256 with `WS_TOKEN_SECRET` (shared with the BFF), issuer `elysion-bff`, audience `elysion-realtime`, expiry (5 s of clock tolerance) and the claims `sub`, `boardId` and `role` (`owner`, `editor`, `viewer`), typed by `@elysion/shared-types`. There is no call to the BFF or Keycloak, so a handshake never depends on either.

- **Admission** (`YjsGateway.admit`) happens before the board is loaded: a token that is missing, malformed, expired, signed with another key or without valid claims closes the socket with **4401**; a valid token whose `boardId` is not the `board` of the URL closes it with **4403** (otherwise one valid token would open every board); a failure of the check itself closes with 1011, never lets the connection in. A missing `board` is still 1008. These are the contract's codes (`WS_CLOSE_UNAUTHORIZED`, `WS_CLOSE_FORBIDDEN` in `@elysion/shared-types`), in the private 4000 range instead of the generic 1008. Messages that arrive while the token is checked and the board loads are handled in order afterwards.
- **Bound to the connection:** the verified `sub` and `role` are kept per socket in `YjsRoom.memberBySocket` (removed when the socket goes away), for read-only viewers (#303) and presence identity. Presence and the document relay are unchanged for admitted connections.
- **Viewers are read-only** (#303): on a connection whose token has `role: viewer`, only sync step 1 (asking for the board's state) is handled; its sync step 2 and update messages are **dropped**, never applied to the document and never relayed, and awareness (cursors) still works. The client is told only if it keeps writing: after 20 dropped messages the socket is closed with 4403 (`Viewers cannot change the board`); a viewer that just looks sends one (the reply to the server's first sync step) and is not affected. Owners and editors are not restricted by role here.
- A token is checked once, at the handshake: an open connection outlives it. The client asks the BFF for a new token on every connect.
- **Fail closed:** the service does not start without `WS_TOKEN_SECRET` (at least 32 characters; `src/config/`). For local runs copy `apps/realtime/.env.example` to `apps/realtime/.env` (loaded at startup).

## Persistence

Board documents survive a restart ([ADR 0011](../adr/0011-board-document-persistence.md)).

- The business backend stores one full Yjs snapshot per board (table `BoardDocuments`, `bytea`, with a version) behind `GET/PUT/DELETE /internal/boards/{id}/document` (minimal API endpoints in `Endpoints/BoardDocumentEndpoints.cs`). `PUT` needs `If-Match: "<version>"`, or `If-None-Match: *` for the first save; a stale version answers `409` with the stored state, no precondition `428`. The route is not exposed at the edge. Deleting a board (`DELETE /boards/{id}`) deletes its document; the document table has no foreign key to `Boards`, because ids such as `default` have no board row.
- Realtime reaches it through the `DocumentStore` interface (`src/persistence/`: `load`, `save`, `delete`); `HttpDocumentStore` is the implementation, configured with `BUSINESS_BACKEND_URL` (default `http://localhost:5174`).
- `YjsRoomRegistry.getOrLoad` loads a room's stored state before the first sync step is answered; connections arriving during the load are queued, and concurrent first connections share one load. **If the load fails the connection is closed with code 1011** (`Board could not be loaded`): an empty board is never served in place of an unloaded one, because the next save would overwrite the real content.
- A changed room is saved 2 s after its last change (at the latest 10 s after the first unsaved change), when its last client leaves, and when the process stops (`enableShutdownHooks`). A save names the version it is based on. If another instance saved first (`409`), realtime merges the stored state in with `Y.applyUpdate` and saves the union. A failed save is retried after 1 s, doubling up to 30 s, and logged as an error; the room stays in memory meanwhile. An unchanged room is never saved.
- **Unloading idle rooms:** when the last client of a room leaves, the room is saved at once and unloaded 30 s later (`ROOM_EVICT_AFTER_MS` changes the grace period): its `Y.Doc` and `Awareness` are destroyed and its presence channel is unsubscribed. A client that connects during the grace period keeps the room; one that connects later gets the stored state. If the final save keeps failing the room stays in memory (its content is the only copy) and unloading is retried every grace period.
- Instances do not rely on the store to see each other's edits: the document relay (below) does that within milliseconds, the store only matters across restarts and as the conflict check.
- Sizes: the state is about the size of the live elements' JSON (a typical board is a few hundred KB, a large one a few MB) and grows by about 1 KB per two seconds of dragging because of Yjs tombstones; see the ADR for the measurements.
- A room that is open when its board is deleted can save its document again. Such orphans are not swept yet.

## Limits

Proposed in [ADR 0026](../adr/0026-board-document-compaction-and-limits.md), implemented by #698: `MAX_UPDATE_BYTES` (2 MiB per Yjs update), `MAX_DOCUMENT_BYTES` (8 MiB encoded state, then updates are refused with a `board-full` message), compaction of a room that empties and is over 1 MiB (the document's `meta.generation` changes; a client that reconnects with an older one is closed with 4409 and reloads its document), and the canvas's limit of 20,000 elements. The measurements are made by `apps/realtime/scripts/measure-compaction.mjs`. Until #698 is done none of this is enforced.

## Document relay

Two `realtime` instances serving one board show the same content: `DocumentRelay` (`src/document/`) publishes every Yjs update that a client sent to an instance on the Valkey channel `elysion:doc:<boardId>` (the `elysion:` prefix keeps the shared Valkey tidy, ADR 0006), and every other instance that has the room open applies it. It has the same shape as `PresenceRelay`: each envelope carries the sender's instance id, so an instance ignores its own messages, and one subscription shares the two Valkey connections.

- Updates that arrive from the relay are applied with their own transaction origin: they are sent to the receiving instance's clients, but not published again (no ping-pong) and not saved by the receiver. The instance whose client made the change saves it (see Persistence); if that instance dies inside the save window the client still has the change and resends it when it reconnects.
- A lost update must not leave instances diverged, so the relay heals itself. Whenever an instance starts following a board (a room is loaded) and whenever Valkey reconnects after an outage, it publishes `hello` with its Yjs state vector. Every peer answers with the update the sender lacks and with its own state vector (`hello-ack`); the sender answers that with the update the peer lacks. An exchange ends after one round, and it works in both directions, so changes made on either side during an outage are exchanged.
- Valkey being unreachable never stops editing: publishing failures are logged and the room keeps working and saving on its own; the hello after the reconnect catches up.
- An unloaded room (see Persistence) unsubscribes from the channel; when someone returns it loads from the store and says hello.

## Presence

Cursor/avatar presence (Yjs awareness, message type 1) is broadcast cross-instance via Redis pub/sub (`PresenceRelay`, `src/presence/`), not just to other clients on the same `realtime` process:

- `YjsRoomRegistry` creates one `y-protocols/awareness` `Awareness` object per room (alongside its `Y.Doc`) and applies every incoming awareness update to it via `applyAwarenessUpdate`.
- `YjsGateway` relays each incoming awareness message to local clients in-memory (as before) **and** publishes it to a Redis channel keyed by board id (`PresenceRelay.publish`); every instance holding that room subscribes to the same channel and relays what it receives to its own local clients. Each publish is tagged with a per-process instance id so an instance ignores its own message coming back off the subscription.
- A client that joins is caught up without a gap: `YjsGateway` first subscribes to the board's presence channel and waits until the subscription is active (`PresenceRelay.subscribe` resolves for every caller only then, also for a connection that arrives while the first one is still subscribing), and only then reads the snapshot. An announcement is recorded in the hash before it is published, so one published before the subscription is in the snapshot and one published after reaches the subscription.
- `YjsRoomRegistry`'s `Awareness.on('update', ...)` listener persists every changed client's state to a Redis hash keyed by board id (`PresenceRelay.recordState`/`removeState`), independent of pub/sub — this is what makes a **snapshot** possible: a newly-connecting client (on any instance, including one that has never seen this board before) is sent every other client's current state (`PresenceRelay.snapshot` → `YjsGateway.sendPresenceSnapshot`), mirroring the sync-step-1-on-connect pattern already used for doc state.
- Valkey is Elysion's own (a `valkey` service of `docker-compose.yml`, [ADR 0023](../adr/0023-own-valkey-one-compose-file.md)); channels and keys are still namespaced: `elysion:presence:<boardId>` (pub/sub) and `elysion:presence:state:<boardId>` (hash).
- All Redis calls from the gateway/registry are fire-and-forget with a logged warning on failure — a Redis outage degrades presence to same-instance-only, it doesn't drop WS connections or doc sync.
- A client's presence ends when its socket does, whatever the reason (clean close, network drop, killed browser): `YjsRoomRegistry` remembers which awareness client ids each socket announced, and `YjsGateway.handleDisconnect` removes them from the room's `Awareness`, which deletes them from Valkey, then sends the removal to the local clients and publishes it so clients on other instances drop the collaborator too.
- Entries left behind by an instance that crashed expire: each hash entry is stored as `<written-at-ms>:<base64 update>`, a client's every announcement (about every 15 s) rewrites it, and `snapshot` deletes and skips entries older than 30 s (`PRESENCE_ENTRY_TTL_MS`, the Awareness `outdatedTimeout`) as well as entries without a timestamp (the format before this rule). The whole hash also expires after 24 hours without a write, so keys of tests and deleted boards do not pile up in the shared Valkey.

## Logging

[ADR 0025](../adr/0025-structured-logging-and-log-viewer.md). `nestjs-pino` with the options of `packages/node-logging` (`@elysion/node-logging`, shared with the BFF so that both write the same line); `src/logging/logging.module.ts`, switched on in `main.ts` (`bufferLogs`, `useLogger`).

- **Format.** One JSON object per line on stdout (`LOG_FORMAT=json`, the default whenever stdout is not a terminal); readable text through `pino-pretty` in a terminal (`LOG_FORMAT=text`). `LOG_LEVEL` is `trace`, `debug`, `info` (default), `warn`, `error` or `fatal`; `loadConfig` validates both at start, like the secrets. `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` (and `OTEL_EXPORTER_OTLP_LOGS_HEADERS`) also sends every line to an OTLP/HTTP logs endpoint, the dev stack's viewer (below); unset, nothing is sent.
- **Fields** (the same in the BFF and the business backend): `timestamp` (ISO 8601, UTC), `level`, `service` (`elysion-realtime`), `requestId`, `message`, `userId` (the WS token's `sub` and nothing else about the person), `err` on an exception, `context` (the Nest class that logged), and the fields of the event (`boardId`, `role`, `reason`, `closeCode`). An HTTP request (`/health`, `/metrics`) ends with the one request line: `http` with `method`, `route`, `status`, `durationMs` (at `debug` for those two paths).
- **A connection has a request id.** `YjsGateway.handleConnection` takes the `X-Request-Id` of the upgrade request when it matches `^[A-Za-z0-9._-]{8,64}$` and creates a UUID otherwise (a browser cannot set the header on a WebSocket, so in practice the service creates it). The id and, once the WS token is verified, the user are kept on a `ConnectionContext` that every callback of the socket enters again (`runInConnection`), so every line the connection causes carries `requestId` and `userId`: `WebSocket connection admitted` and `WebSocket connection closed` (`boardId`, `role`), a viewer's dropped writes, a failed load.
- **The internal document API gets the same id.** `HttpDocumentStore` sends `X-Request-Id` on every call, so the business backend's lines for a load or a save carry the connection's id. A save runs from a timer, outside any connection: the registry remembers the connection whose change made the room dirty and runs the save as that connection, so a failed save can be followed to the user who caused it.
- **Refused connections** log `WebSocket connection refused` at `warn` with `reason` (`missing`, `expired`, `wrong_issuer`, `wrong_audience`, `wrong_algorithm`, `invalid_signature`, `malformed`, `missing_claim`, `invalid`, or `wrong_board` for a valid token for another board) and `closeCode` (`4401` or `4403`), never the token. The upgrade URL carries the token in its query, so no line contains a URL: the request line has the route, the connection lines have the board id.
- **Never logged:** `Authorization`, `Cookie`, query strings (the WS token), and secrets. `test/logging.e2e-spec.ts` connects with markers in each and asserts that none reaches the output.

## Open questions

None at the moment. The WS-token issuance question is settled: the BFF issues it ([identity.md](identity.md)).
