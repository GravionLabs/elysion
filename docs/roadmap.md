# Implementation order

The order in which the open backlog is built, by phase. Each phase lists its PBIs in the order they
should be implemented; a PBI's tasks are its GitHub sub-issues. The same order is on the project
board ([GravionLabs project 7](https://github.com/users/GravionLabs/projects/7)): the **Phase** field
holds the phase and the items are sorted in this order.

Refined on 2026-10-05. When the backlog changes, update this file and the board together.

## Phase 1 Foundation

Cheap groundwork that every later PR benefits from: one command verifies the whole repository including .NET, every TypeScript app is linted, CI runs on every PR, and the whole stack runs behind Traefik (which the gateway auth work in phase 5 needs for its checks).

1. #246 chore: run the .NET build, tests and format check from the root scripts (Feature #106)
2. #249 chore: lint the Angular and canvas apps with oxlint (Feature #107)
3. #253 chore: format and lint staged files on commit (Feature #107)
4. #256 ci: verify every push and pull request with GitHub Actions (Feature #29)
5. #261 feat: run bff, realtime, business backend and frontend in the dev compose behind Traefik (Feature #28)

## Phase 2 Durable boards

The largest functional gap: today a realtime restart wipes every board, and two realtime instances diverge on content. The persistence ADR comes first; deleting and duplicating boards in phase 3 build on its storage.

1. #266 docs: decide where board documents are persisted and record it as an ADR (Feature #98)
2. #269 feat: persist board documents and restore them after a restart (Feature #98)
3. #282 fix: remove the presence of clients that dropped without closing (Feature #100)
4. #279 feat: unload idle board rooms after their last client leaves (Feature #100)
5. #274 feat: relay document updates between realtime instances through Valkey (Feature #99)

## Phase 3 Board management

The product surface around the canvas: a home page with the board list, rename, delete and duplicate, plus the open canvas items (toolbar zoom and undo/redo, PDF export). The PDF ADR (#235) also decides whether the server-side export service #23 is needed at all.

1. #286 feat: board list home page with New board (Feature #102)
2. #291 feat: rename a board from the top bar (Feature #102)
3. #295 feat: delete a board from the board list (Feature #102)
4. #299 feat: duplicate a board including its content (Feature #102)
5. #181 feat: free the bottom-left corner by moving zoom and undo/redo into the toolbar (Feature #179)
6. #234 feat: export the board or the selection as a PDF document (Feature #104)

## Phase 4 Presence

Collaborators' cursors and a presence indicator, with a session identity that phase 5 replaces by the logged-in user.

1. #108 feat: handle Yjs awareness in the canvas WebSocket client (Feature #27)
2. #109 feat: render remote collaborators on the Excalidraw canvas (Feature #27)
3. #110 feat: expose presence to Angular via the element contract and a presence service (Feature #27)

## Phase 5 Identity and access

Keycloak, tokens and authorization end to end, in dependency order: provider and token-flow spec, backend authentication and membership model, BFF verification and WS tokens, edge and handshake checks, then the frontend login, sharing, and the SignalStore decision that ADR 0009 deferred to this point.

1. #111 feat: add Keycloak to the dev stack with an imported elysion realm (Feature #95)
2. #112 docs: specify the Elysion token flow (Feature #95)
3. #118 feat: add a config module with env validation to the BFF (Feature #13)
4. #116 feat: authenticate requests against Keycloak with JWT bearer (Feature #20)
5. #114 feat: add User and BoardMembership entities with a migration (Feature #96)
6. #115 feat: provision users just-in-time from JWT claims (Feature #96)
7. #117 feat: enforce board authorization policies (Feature #20)
8. #119 feat: validate Keycloak JWTs and expose a verify endpoint for forwardAuth (Feature #13)
9. #120 feat: issue short-lived board-scoped WS tokens (Feature #13)
10. #121 feat: enforce auth at the edge with a Traefik forwardAuth middleware (Feature #8)
11. #122 feat: validate the WS token at the Yjs handshake (Feature #18)
12. #303 feat: reject document updates from viewers (Feature #18)
13. #306 feat: log in with Keycloak and attach the token to API calls (Feature #97)
14. #312 feat: connect the canvas with a board-scoped WS token and renew it on reconnect (Feature #97)
15. #320 feat: manage board members through the API (Feature #245)
16. #324 feat: share a board from the top bar and open it read-only as a viewer (Feature #245)
17. #317 refactor: decide on NgRx SignalStore once session, presence and board list exist (Feature #97)

## Phase 6 Templates

Templates: a catalog with built-in templates, picking one for a new board, inserting one into a board, and saving your own.

1. #328 feat: template catalog API with built-in templates (Feature #22)
2. #332 feat: pick a template when creating a board (Feature #103)
3. #336 feat: add a template to the current board (Feature #103)
4. #340 feat: save a board or the selection as a template (Feature #22)

## Phase 7 Operations

Operations work that only pays off once the product runs somewhere shared: CORS and rate limits, logs and metrics, caching (only if measured to be needed) and Kubernetes.

1. #344 feat: CORS and rate limiting middlewares at the edge (Feature #9)
2. #347 feat: Traefik access logs and Prometheus metrics (Feature #10)
3. #351 feat: cache the board list in Valkey (Feature #12)
4. #355 feat: Kubernetes manifests for all services (Feature #30)
