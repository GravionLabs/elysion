# Realtime backend spec (NestJS, TypeScript 6)

## Owner
Backend

## Responsibilities
WebSocket gateway for Yjs CRDT sync, Redis-backed presence service, JWT validation at handshake, horizontal scaling via Redis. See ADR 0002.

## Protocol

- `YjsGateway` (`src/yjs/`) speaks the standard Yjs sync sub-protocol (`y-protocols/sync`) over a raw WebSocket at a fixed path, `/yjs`. The board id is **not** a path segment — `@nestjs/platform-ws`'s `WsAdapter` routes an upgrade to a gateway by exact pathname match, with no wildcard/pattern support, so a dynamic per-board path isn't possible without a custom adapter. Instead, the board id travels as a query parameter: `ws://<host>/yjs?board=<board-id>`.
- One `Y.Doc` per board id, held in memory for the process lifetime (`YjsRoomRegistry`) — no persistence, and no cross-instance broadcast yet. Horizontal scaling (Redis-backed doc broadcast across instances) is a follow-up, not yet scoped to an issue.
- Awareness protocol messages (message type 1) are relayed verbatim to other clients in the same room, unread — presence semantics (cursor position, avatar, selection) are Feature #17's job; this gateway only keeps the wire protocol from breaking for clients that also send awareness updates.
- WS handshake auth (JWT/short-lived token validation) is not implemented yet — see Feature #18.

## Open questions
- Short-lived WS-token issuance flow (BFF vs gateway).
- How doc updates get broadcast across multiple `realtime` instances once this needs to scale horizontally (Redis pub/sub, most likely — see the presence protocol's approach above, which will already need it).
