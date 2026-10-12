# Roadmap

What has been built, by phase, and what is next. Each phase is a GitHub milestone holding its features, PBIs and tasks
([M1 to M11](https://github.com/GravionLabs/elysion/milestones?state=closed)); epics span several phases and have no
milestone. The backlog and its order are on the project board
([GravionLabs project 7](https://github.com/users/GravionLabs/projects/7)). When the plan changes, update this file and the
board together.

Last refreshed on 2026-10-12. **Phases M1 to M15 are done** (released as 0.1 and 0.2); what is left is in [What is next](#what-is-next).

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

## M13 Enterprise identity (done, released in 0.1 and 0.2)

A company runs Elysion with its own identity (Epic #636, [ADR 0027](adr/0027-enterprise-sign-in-groups-and-administration.md)):

- **Sign in with Microsoft Entra ID** through Keycloak identity brokering, with a second realm (`entra-stub`) as a stand-in for
  development and the browser tests, and the shell going straight to the company's login (#637).
- **User groups** from the token's `groups` claim or made locally, with a role on a room; the highest of board, room and
  group role wins, and the realtime handshake does not change (#646).
- **Administration and a user directory:** the realm role `elysion-admin`, admin pages for users, groups and rooms, and
  finding people by name in the Share dialog (#655).
- **Directory sync and the account lifecycle:** group members from Microsoft Graph before they sign in (off unless configured),
  deactivation and hand-over, and an audit log with retention (#666).

## M14 Production readiness (done, released in 0.1)

What had to be true before anything real depends on Elysion (Epic #670, decisions in [ADR 0026](adr/0026-board-document-compaction-and-limits.md) and [ADR 0028](adr/0028-production-topology-tls-and-keycloak.md)):

- **Production configuration and security** (#671): production on Kubernetes through the Helm chart with TLS and Keycloak run by the
  operator, a production realm, a security review with scanning in CI ([docs/security.md](security.md)), security headers and a CSP.
- **Backups, alerting and a hardened Helm chart** (#683): a rehearsed restore, alert rules on the metrics, probes, security
  contexts, PDBs and an HPA, an upgrade test from the last pre-release.
- **Board documents, images and limits** (#696): compaction with a document generation, limits on updates, documents and
  elements, images in the object store, a load test with two replicas and the sizing ([docs/performance.md](performance.md)).
- **Browser tests** (#713): rooms, templates, import and export, the drawing tools, reconnect.

## M15 Product gaps (done)

The gaps users noticed first (Epic #722):

- **Import and export** (#723): several images at once, SVG to PNG, PDF import, PDF export with one page per frame and options,
  a whole room as one PDF.
- **Finding a board** (#728): a picture on the card, search, sorting, favorites, last opened.
- **Collaboration** (#731, [ADR 0029](adr/0029-dot-voting-on-the-server.md)): secret dot voting on the server and viewers can vote,
  comments with mentions, invitation links, working through an outage with a copy on the device.
- **Dark theme colors, a German interface and accessibility** (#736): sticky notes read as the dark palette's colors in the dark
  theme (#737), everything else of the dark theme is Excalidraw's own filter.

## What is next

- **Agent skills per project** (#824): `apm install` before working, the skill folders are not committed.
- **Checks by hand that CI cannot do:** a screen reader pass ([#739](https://github.com/GravionLabs/elysion/issues/739)), a real Entra
  tenant (the stand-in does not show Entra's own claim shapes), the Helm chart on a managed cluster, and the weekly load workflow.
- **Known limit:** the votes of one person can exceed their limit by one when two requests arrive at the same moment
  ([docs/specs/business-backend.md](specs/business-backend.md)).
