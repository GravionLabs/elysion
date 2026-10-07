# Implementation order

The order in which the open backlog is built, by phase. Each phase lists its PBIs in the order they
should be implemented; a PBI's tasks are its GitHub sub-issues. The same order is on the project
board ([GravionLabs project 7](https://github.com/users/GravionLabs/projects/7)): the **Phase** field
holds the phase and the items are sorted in this order. Each phase is a GitHub milestone
(M1 to M9) holding its features, PBIs and tasks; epics span several phases and have no milestone.

Refined on 2026-10-06; open PBIs only, finished ones drop out (last refreshed 2026-10-06). When the backlog changes, update this file and the board together.

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

All PBIs of this phase are done.

## M6 Templates

Milestone: [M6 Templates](https://github.com/GravionLabs/elysion/milestone/6)

Templates: a catalog with built-in templates, picking one for a new board, inserting one into a board, and saving your own.

All PBIs of this phase are done.

## M7 Operations

Milestone: [M7 Operations](https://github.com/GravionLabs/elysion/milestone/7)

Operations work that only pays off once the product runs somewhere shared: CORS and rate limits, logs and metrics, caching (measured: not needed, see docs/specs/bff.md) and Kubernetes (a Helm chart, ADR 0018).

All PBIs of this phase are done.

## M8 Connectors

Milestone: [M8 Connectors](https://github.com/GravionLabs/elysion/milestone/8)

Connecting two elements the way Mural does: visible connection points on every shape, drag from one to another shape (or into empty space for a new sticky note), right-angled connectors by default, and a Connect action for two selected elements. The technique is in docs/specs/frontend.md ("Connectors").

All PBIs of this phase are done.

## M9 Canvas polish

Milestone: [M9 Canvas polish](https://github.com/GravionLabs/elysion/milestone/9)

Three things from using the board (owner, 2026-10-07): the canvas menu moves from Excalidraw's hamburger into the toolbar, elements can snap to a grid that can also be shown (20 px by default, selectable), and sticky notes remember their color (yellow at first), are made with one click, show their colors as note icons and carry the color as their background.

All PBIs of this phase are done.
