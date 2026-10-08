# apps/e2e — browser tests of the running stack

Playwright tests with two browsers on one board (user A and user B): a board from a template, sharing, the shared timer, the dot voting
(ending by itself when both have voted) and a viewer's limits. They are **not** part of `pnpm test`: they need the whole stack.

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
- Keep a test independent of the data of other tests and leave nothing behind on the stack.
