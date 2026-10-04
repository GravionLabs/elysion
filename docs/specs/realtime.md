# Realtime backend spec (NestJS, TypeScript 6)

## Owner

Backend

## Responsibilities

WebSocket gateway for Yjs CRDT sync, Redis-backed presence service, JWT validation at handshake, horizontal scaling via Redis. See ADR 0002.

## Protocol

- `YjsGateway` (`src/yjs/`) speaks the standard Yjs sync sub-protocol (`y-protocols/sync`) over a raw WebSocket at a fixed path, `/yjs`. The board id is **not** a path segment — `@nestjs/platform-ws`'s `WsAdapter` routes an upgrade to a gateway by exact pathname match, with no wildcard/pattern support, so a dynamic per-board path isn't possible without a custom adapter. Instead, the board id travels as a query parameter: `ws://<host>/yjs?board=<board-id>`.
- One `Y.Doc` per board id, held in memory for the process lifetime (`YjsRoomRegistry`) — no persistence, and no cross-instance _doc content_ broadcast yet. Horizontal scaling for doc updates (Redis-backed doc broadcast across instances) is a follow-up, not yet scoped to an issue — presence (below) already solves the analogous problem for awareness state.
- WS handshake auth (JWT/short-lived token validation) is not implemented yet — see Feature #18.

## Presence

Cursor/avatar presence (Yjs awareness, message type 1) is broadcast cross-instance via Redis pub/sub (`PresenceRelay`, `src/presence/`), not just to other clients on the same `realtime` process:

- `YjsRoomRegistry` creates one `y-protocols/awareness` `Awareness` object per room (alongside its `Y.Doc`) and applies every incoming awareness update to it via `applyAwarenessUpdate`.
- `YjsGateway` relays each incoming awareness message to local clients in-memory (as before) **and** publishes it to a Redis channel keyed by board id (`PresenceRelay.publish`); every instance holding that room subscribes to the same channel and relays what it receives to its own local clients. Each publish is tagged with a per-process instance id so an instance ignores its own message coming back off the subscription.
- `YjsRoomRegistry`'s `Awareness.on('update', ...)` listener persists every changed client's state to a Redis hash keyed by board id (`PresenceRelay.recordState`/`removeState`), independent of pub/sub — this is what makes a **snapshot** possible: a newly-connecting client (on any instance, including one that has never seen this board before) is sent every other client's current state (`PresenceRelay.snapshot` → `YjsGateway.sendPresenceSnapshot`), mirroring the sync-step-1-on-connect pattern already used for doc state.
- All Redis calls from the gateway/registry are fire-and-forget with a logged warning on failure — a Redis outage degrades presence to same-instance-only, it doesn't drop WS connections or doc sync.
- Not yet handled: proactively clearing a client's presence state on disconnect (today it's only removed when overwritten or when the 30s Awareness `outdatedTimeout` expires on some instance's local Awareness object, which doesn't itself talk to Redis).

## Open questions

- Short-lived WS-token issuance flow (BFF vs gateway).
- How doc updates get broadcast across multiple `realtime` instances once this needs to scale horizontally (Redis pub/sub, most likely — see `PresenceRelay` for the now-solved analogous case for presence).
