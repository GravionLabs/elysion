# apps/e2e — browser tests of the running stack

Playwright tests with two browsers on one board (user A and user B). They are **not** part of `pnpm test`: they need the whole stack.

| Suite                   | What it checks                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `collaboration.spec.ts` | a board from a template, sharing, the shared timer, the dot voting (ending by itself when both have voted), a viewer's limits    |
| `files.spec.ts`         | images: the bytes in the object store, the other person sees them, they survive a reload                                         |
| `rooms.spec.ts`         | a room, shared as editor, a board in it, moving it out, deleting the room (the boards stay)                                      |
| `templates.spec.ts`     | the element count of each built-in template, adding one to a board, an own template (save, find, delete)                         |
| `io.spec.ts`            | importing `fixtures/sample.excalidraw`; PNG, SVG, PDF and Excalidraw export as downloads; exporting the selection only           |
| `drawing.spec.ts`       | rectangle, text, sticky note color, arrow, a connector from a connection point that follows its shape, undo and redo; B compares |
| `reconnect.spec.ts`     | the realtime service stopped and started (`compose` helper), drawing during the outage, a WS token of 5 seconds                  |

```sh
pnpm demo                                   # or: docker compose up -d --build (the stack, on http://localhost)
pnpm --filter @elysion/e2e exec playwright install chromium   # once
pnpm test:browser
```

- `E2E_USER_A` / `E2E_USER_B` (default `dev1` and `dev2`; the password is the username). A Keycloak database that was imported before `dev1`
  and `dev2` were in the realm has only `dev` and `guest`: `E2E_USER_A=guest E2E_USER_B=dev pnpm test:browser`.
- `E2E_BASE_URL` (default `http://localhost`), `E2E_CHROME_PATH` (a browser of the machine instead of Playwright's own).
- The tests of a file run in order on one board that the first test makes and the last one deletes. The canvas is drawn on a `<canvas>`:
  check what shows in the page (the top bar, the results dialog), and click the notes by the coordinates of the Retrospective template in a
  1280x800 window (`FIRST_NOTE`).
- CI runs them in `container.yml` after `scripts/demo-smoke.sh`; a failure uploads the Playwright report as an artifact.
- **The canvas helpers** (`helpers.ts`): `boardElements(page)` / `elementCount(page)` read the board's own Excalidraw export (what the canvas element offers, `exportBoard('excalidraw')`), so a test checks elements, their ids, positions and bindings, not pixels. Draw with the mouse in page coordinates and keep clear of the property panel (the left 220 px while a tool is active) and of the toolbar at the bottom. `createBoard`, `deleteBoardsNamed`, `openBoardList` and `boardCard` do the board list.
- **`reconnect.spec.ts` stops and starts a container** of the stack it runs against (`docker compose stop realtime`, then `start`; `pause` would keep the TCP connections open and the browser would not notice) and recreates the BFF with `WS_TOKEN_TTL_SECONDS=5` (a variable of `docker-compose.yml`; the test sets it back). It runs `docker compose` in the repository root, so the stack has to be this one; it is skipped with `E2E_NO_COMPOSE=1`.
- Keep a test independent of the data of other tests and leave nothing behind on the stack.
