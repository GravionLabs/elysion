# Realtime backend spec (NestJS, TypeScript 7)

## Owner
Backend

## Responsibilities
WebSocket gateway for Yjs CRDT sync, Redis-backed presence service, JWT validation at handshake, horizontal scaling via Redis. See ADR 0002.

## Protocol (draft)
- Yjs sync protocol over WebSocket, namespaced per board id.
- Presence messages: cursor position, avatar, selection — broadcast via Redis pub/sub across instances.

## Open questions
- Short-lived WS-token issuance flow (BFF vs gateway).
