# Roadmap

What has been built, by phase, and what is next. Each phase is a GitHub milestone holding its features, PBIs and tasks
([M1 to M11](https://github.com/GravionLabs/elysion/milestones?state=closed)); epics span several phases and have no
milestone. The backlog and its order are on the project board
([GravionLabs project 7](https://github.com/users/GravionLabs/projects/7)). When the plan changes, update this file and the
board together.

Last refreshed on 2026-10-07. **Phases M1 to M11 are done**; there is no open issue.

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

## After the pre-release

Not planned in detail yet; roughly in this order.

1. **A security review** of the services and the images, and a production configuration: TLS, a host name, a production Keycloak, secrets
   ([ADR 0014](adr/0014-keycloak-identity-provider.md), [ADR 0017](adr/0017-internal-api-authentication.md), the Helm chart).
2. **Browser end-to-end tests** with two real users: sharing, rooms, the timer and the voting.
3. **Real board thumbnails** on the cards of the overview.
4. **Votes on the server** if viewers must be able to vote or the votes must be secret ([ADR 0020](adr/0020-facilitation-state.md), option C).
5. **Housekeeping:** the initial bundle is over its 500 kB warning budget, `board-list.scss` is at its limit, and one canvas test
   (`QuickConnect.spec.tsx`) is flaky under load.
