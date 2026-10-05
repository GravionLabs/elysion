# Implementation order

The order in which the open backlog is built, by phase. Each phase lists its PBIs in the order they
should be implemented; a PBI's tasks are its GitHub sub-issues. The same order is on the project
board ([GravionLabs project 7](https://github.com/users/GravionLabs/projects/7)): the **Phase** field
holds the phase and the items are sorted in this order. Each phase is a GitHub milestone
(M1 to M7) holding its features, PBIs and tasks; epics span several phases and have no milestone.

Refined on 2026-10-05; open PBIs only, finished ones drop out (last refreshed 2026-10-05). When the backlog changes, update this file and the board together.

## M1 Foundation

Milestone: [M1 Foundation](https://github.com/GravionLabs/elysion/milestone/1)

Cheap groundwork that every later PR benefits from: one command verifies the whole repository including .NET, every TypeScript app is linted, CI runs on every PR, and the whole stack runs behind Traefik (which the gateway auth work in M5 needs for its checks).

All PBIs of this phase are done.

## M2 Durable boards

Milestone: [M2 Durable boards](https://github.com/GravionLabs/elysion/milestone/2)

The largest functional gap: today a realtime restart wipes every board, and two realtime instances diverge on content. The persistence ADR comes first; deleting and duplicating boards in M3 build on its storage.

All PBIs of this phase are done.

## M3 Board management

Milestone: [M3 Board management](https://github.com/GravionLabs/elysion/milestone/3)

The product surface around the canvas: a home page with the board list, rename, delete and duplicate, plus the open canvas items (toolbar zoom and undo/redo, PDF export). The PDF ADR (#235) also decides whether the server-side export service #23 is needed at all.

1. #286 feat: board list home page with New board (Feature #102)
2. #291 feat: rename a board from the top bar (Feature #102)
3. #295 feat: delete a board from the board list (Feature #102)
4. #299 feat: duplicate a board including its content (Feature #102)
5. #181 feat: free the bottom-left corner by moving zoom and undo/redo into the toolbar (Feature #179)
6. #234 feat: export the board or the selection as a PDF document (Feature #104)

## M4 Presence

Milestone: [M4 Presence](https://github.com/GravionLabs/elysion/milestone/4)

Collaborators' cursors and a presence indicator, with a session identity that M5 replaces by the logged-in user.

1. #108 feat: handle Yjs awareness in the canvas WebSocket client (Feature #27)
2. #109 feat: render remote collaborators on the Excalidraw canvas (Feature #27)
3. #110 feat: expose presence to Angular via the element contract and a presence service (Feature #27)

## M5 Identity and access

Milestone: [M5 Identity and access](https://github.com/GravionLabs/elysion/milestone/5)

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

## M6 Templates

Milestone: [M6 Templates](https://github.com/GravionLabs/elysion/milestone/6)

Templates: a catalog with built-in templates, picking one for a new board, inserting one into a board, and saving your own.

1. #328 feat: template catalog API with built-in templates (Feature #22)
2. #332 feat: pick a template when creating a board (Feature #103)
3. #336 feat: add a template to the current board (Feature #103)
4. #340 feat: save a board or the selection as a template (Feature #22)

## M7 Operations

Milestone: [M7 Operations](https://github.com/GravionLabs/elysion/milestone/7)

Operations work that only pays off once the product runs somewhere shared: CORS and rate limits, logs and metrics, caching (only if measured to be needed) and Kubernetes.

1. #344 feat: CORS and rate limiting middlewares at the edge (Feature #9)
2. #347 feat: Traefik access logs and Prometheus metrics (Feature #10)
3. #351 feat: cache the board list in Valkey (Feature #12)
4. #355 feat: Kubernetes manifests for all services (Feature #30)
