# apps/realtime — Agent Instructions

NestJS WebSocket gateway for Yjs CRDT sync and Redis-backed presence (cursors/avatars). TypeScript **6**, not 7 — same reasoning as `apps/bff`, see that app's `AGENTS.md` and `docs/adr/0002-typescript-version-split.md`.

See `docs/specs/realtime.md`.

## Commands

```sh
pnpm --filter @elysion/realtime start
pnpm --filter @elysion/realtime run build
pnpm --filter @elysion/realtime test
```

## WebSocket adapter

Uses `@nestjs/platform-ws` (plain `ws`), **not** `@nestjs/platform-socket.io` — the real client will be a plain Yjs WebSocket connection, not a Socket.IO client. The adapter is wired explicitly in `src/main.ts` via `app.useWebSocketAdapter(new WsAdapter(app))`; new gateways don't need to repeat this, it's app-wide.

`src/echo.gateway.ts` is a placeholder (`@SubscribeMessage('echo')` round-trips the payload) standing in for the future Yjs sync gateway — replace it, don't build alongside it, when Yjs integration lands (Feature: "Yjs sync protocol integration").

## Conventions

- Package name `@elysion/realtime` (not `realtime`).
- `"files": ["dist"]` in `package.json` — same `pnpm deploy` reasoning as `apps/bff`.

## Docker

Build from the repo root: `docker build -f apps/realtime/Dockerfile -t elysion-realtime .`. Same multi-stage `pnpm deploy --prod` pattern as `apps/bff`.

## Verifying changes

Build and run (`node dist/main.js`), then connect with a real WebSocket client (not just curl) and confirm the message round-trips — see the `ws`-based test script used when this was scaffolded for the pattern. For Dockerfile changes, do a real `docker build` + `docker run` + WS round-trip against the container.
