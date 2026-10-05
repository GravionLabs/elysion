# apps/realtime — Agent Instructions

NestJS WebSocket gateway for Yjs CRDT sync and Redis-backed presence (cursors/avatars). Board documents are persisted through the business backend (`BUSINESS_BACKEND_URL`, default `http://localhost:5174`): **without the backend running, no board opens** (connections are closed with 1011). TypeScript **6**, not 7 — same reasoning as `apps/bff`, see that app's `AGENTS.md` and `docs/adr/0002-typescript-version-split.md`.

See `docs/specs/realtime.md`.

## Commands

```sh
pnpm --filter @elysion/realtime start
pnpm --filter @elysion/realtime run build
pnpm --filter @elysion/realtime test
```

## WebSocket adapter

Uses `@nestjs/platform-ws` (plain `ws`), **not** `@nestjs/platform-socket.io` — the real client will be a plain Yjs WebSocket connection, not a Socket.IO client. The adapter is wired explicitly in `src/main.ts` via `app.useWebSocketAdapter(new WsAdapter(app))`; new gateways don't need to repeat this, it's app-wide.

`src/yjs/yjs.gateway.ts` is the Yjs CRDT sync gateway (Feature #16) — one `Y.Doc` per board id (`YjsRoomRegistry`), joined via `ws://.../yjs?board=<board-id>` (query param, not a path segment — see `docs/specs/realtime.md` for why). Presence (#17) and WS auth (#18) are separate, not-yet-implemented features that plug into this gateway later.

## Authentication

Every `/yjs` connection needs `?token=` (the BFF's board-scoped WS token): `src/auth/` verifies it locally and `YjsGateway.admit` closes with 4401 (no usable token) or 4403 (token for another board) before the board is loaded; the verified `sub` and `role` are in `YjsRoom.memberBySocket`. The token contract lives in `packages/shared-types` (rebuild it with `pnpm --filter @elysion/shared-types build` after editing). The service does not start without `WS_TOKEN_SECRET`: copy `.env.example` to `.env` for local runs; tests get theirs from `vitest.config*.ts`, and `test/ws-token.ts` signs tokens (`boardUrl(base, boardId, options)` builds a connection URL) so an e2e client is one call. Never accept a connection without a token "for testing". A viewer's sync step 2 and update messages are dropped in `YjsGateway.handleMessage` (a client that keeps writing is closed with 4403 after `MAX_DROPPED_VIEWER_WRITES`); any new message type that changes the document must get the same check.

## Document relay

`src/document/document-relay.ts` relays Yjs updates between instances on `elysion:doc:<boardId>` and heals gaps with a `hello` / `hello-ack` state-vector exchange (details in `docs/specs/realtime.md`). Unit tests put several registries on one `FakeRedisBus` (`src/testing/fake-redis.ts`); `test/document-relay.e2e-spec.ts` runs two real instances against the shared Valkey. Shared e2e helpers (`SyncClient`, `startInstance`) are in `test/helpers.ts`.

## Persistence

`src/persistence/` holds the `DocumentStore` interface (`load`, `save`, `delete`) and `HttpDocumentStore` (ADR 0011; protocol in `docs/specs/realtime.md`). `YjsRoomRegistry.getOrLoad` is async and fails when the store does; A room without clients is saved and unloaded after a grace period (`ROOM_EVICT_AFTER_MS`, default 30000; `YjsRoomRegistry.release`); the e2e suites shorten the registry's timings by overriding `PERSISTENCE_OPTIONS`. `InMemoryDocumentStore` is for tests: the e2e suites replace `DocumentStore` with it (`overrideProvider(DocumentStore)`), `test/persistence.e2e-spec.ts` covers a restart.

## Conventions

- Package name `@elysion/realtime` (not `realtime`).
- `"files": ["dist"]` in `package.json` — same `pnpm deploy` reasoning as `apps/bff`.

## Docker

Build from the repo root: `docker build -f apps/realtime/Dockerfile -t elysion-realtime .`. Same multi-stage `pnpm deploy --prod` pattern as `apps/bff`.

## Verifying changes

`pnpm --filter @elysion/realtime run test:e2e` boots the real Nest app (with `WsAdapter`, actually listening) and drives it with real WebSocket clients — `test/yjs.e2e-spec.ts` is the pattern to extend for new gateway behavior, not mocks. For anything WS-related, also build and run (`node dist/main.js`) and connect with a real WebSocket client by hand at least once — an e2e test proves the protocol works, not that the process actually boots standalone. For Dockerfile changes, do a real `docker build` + `docker run` + WS round-trip against the container.
