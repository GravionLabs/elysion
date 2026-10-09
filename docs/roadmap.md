# Roadmap

What has been built, by phase, and what is next. Each phase is a GitHub milestone holding its features, PBIs and tasks
([M1 to M11](https://github.com/GravionLabs/elysion/milestones?state=closed)); epics span several phases and have no
milestone. The backlog and its order are on the project board
([GravionLabs project 7](https://github.com/users/GravionLabs/projects/7)). When the plan changes, update this file and the
board together.

Last refreshed on 2026-10-09. **Phases M1 to M11 are done**; structured logs with a request id and a log viewer in the dev stack are done (#625); M13 to M15 are planned (Epics #636, #670 and #722).

## Done

| Phase                   | What it brought                                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 Foundation           | One command verifies the whole repository including .NET; every TypeScript app is linted; CI on every pull request; the whole stack behind Traefik.                              |
| M2 Durable boards       | Boards are persisted by the business backend and survive a restart; two realtime instances stay in step ([ADR 0011](adr/0011-board-document-persistence.md)).                    |
| M3 Board management     | The board overview with create, rename, delete and duplicate; the toolbar's zoom and undo; PDF export ([ADR 0013](adr/0013-pdf-export.md)).                                      |
| M4 Presence             | Cursors, names and avatars of everybody on the board.                                                                                                                            |
| M5 Identity and access  | Keycloak, tokens and authorization end to end: roles per board, sharing, the WS token, edge and handshake checks.                                                                |
| M6 Templates            | A catalog with built-in templates, picking one for a new board, adding one to a board, saving your own.                                                                          |
| M7 Operations           | CORS and rate limits, logs and metrics, a Helm chart ([ADR 0018](adr/0018-kubernetes-packaging.md)); a cache was measured and is not needed ([docs/specs/bff.md](specs/bff.md)). |
| M8 Connectors           | Connection points, right-angled connectors, quick connect.                                                                                                                       |
| M9 Canvas polish        | The canvas menu in the toolbar, a grid with snapping, sticky notes with a remembered color.                                                                                      |
| M10 Branding and boards | The project icon, the board overview that uses the page, rooms as shared spaces ([ADR 0019](adr/0019-grouping-boards.md)).                                                       |
| M11 Facilitation        | A shared timer and dot voting, kept in the board's Yjs document ([ADR 0020](adr/0020-facilitation-state.md)).                                                                    |

After M11: a self-contained demo (`pnpm demo`), and the sticky note menu showing the colors as the canvas draws them.

## M12 First pre-release

The first version that others can run without building it: a version from the git history, images, release notes and a
documentation site.

- **Versioning and release:** [GitVersion](https://gitversion.net) gives the version from the git history (`GitVersion.yml`); a merge to `main`
  that passes the checks publishes the four images to GHCR and creates a GitHub **pre-release** with notes from the Conventional Commits (git-cliff).
- **Self-hosting:** `docs/self-hosting.md` and a compose file that runs the published images.
- **Documentation site** on GitHub Pages, built from `docs/` and the README.
- **A container check on pull requests:** the images build and the demo stack starts.

## M13 Enterprise identity

A company runs Elysion with its own identity (Epic #636; the ADR of #638 decides the details):

- **Sign in with Microsoft Entra ID** through Keycloak identity brokering, with a second realm as a stand-in for development
  and the browser tests, and the shell going straight to the company's login (#637).
- **User groups** from the token's `groups` claim or made locally, with a role on a room; the highest of board, room and
  group role wins, and the realtime handshake does not change (#646).
- **Administration and a user directory:** the realm role `elysion-admin`, admin pages for users, groups and rooms, and
  finding people by name in the Share dialog (#655).
- **Later:** group members from Microsoft Graph before they sign in, deactivation and hand-over, an audit log (#666).

## M14 Production readiness

What has to be true before anything real depends on Elysion (Epic #670):

- **Production configuration and security** (#671): the topology decision (#672), a production overlay with TLS and
  Keycloak in production mode, a security review with scanning in CI, security headers and a CSP.
- **Backups, alerting and a hardened Helm chart** (#683): a rehearsed restore, alert rules on the metrics, probes,
  security contexts, PDBs and an HPA, an upgrade test from the last pre-release.
- **Board documents, images and limits** (#696): compaction and a size limit (decision #697), images in the object
  store (today an image is visible to its author only and gone after a reload, #702), a load test, the bundle budget.
- **Browser tests and housekeeping** (#713): rooms, templates, import and export, the drawing tools, reconnect; the
  flaky canvas test and the stylesheet at its limit.

## M15 Product gaps

The gaps users notice first (Epic #722; PBIs written, tasks when scheduled): PDF and image import and a better export
(#723), thumbnails, search, sorting and favorites (#728), secret votes, comments, invitation links and working through
an outage (#731), dark theme colors, a German interface and accessibility (#736).

## After the pre-release

Nothing is left over: everything of the earlier list is in M14 and M15. Structured logs with a request id and a log
viewer in the dev stack are done ([ADR 0025](adr/0025-structured-logging-and-log-viewer.md), #625).
