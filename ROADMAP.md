# Roadmap

Order of work and release assignment for the open issues. Written 2026-10-31 with the move to the rolling release branch
([ADR 0030](docs/adr/0030-rolling-release-branch.md)). Last release `v0.1.0-beta.216`. Work runs on `release/next`; the release pull request
into `main` is the human review point, and each release has a GitHub milestone of the same name. `/deliver --milestone 0.5.0` delivers
the PBIs below in this order.

What was built so far, phase by phase, is in [docs/roadmap.md](docs/roadmap.md).

## Where we are

| Epic / Feature                                    | State                     | Note                                     |
| ------------------------------------------------- | ------------------------- | ---------------------------------------- |
| #842 Workshops and integrations                   | open: Features #843, #844 | milestone 0.5.0                          |
| #843 Running a workshop                           | open: #845–#849           | starts with the snapshot decision (#845) |
| #844 Integrations: a public REST API and webhooks | open: #850–#853           | starts with the API decision (#850)      |
| #867 Aspire AppHost for local development         | `needs-decision`, PR #868 | out of 0.5.0 until decided               |

## 0.5.0 — Workshops and integrations

Milestone 0.5.0 (formerly M16). `release/next` is cut from `main` at `3add5dc`.

| Order | Issue | Title                                                                  | Depends on / decision |
| ----- | ----- | ---------------------------------------------------------------------- | --------------------- |
| 1     | #871  | move to GravionLabs/skills                                             | — (supersedes #824)   |
| 2     | #845  | decide how board snapshots are stored and restored                     | decision, ADR first   |
| 2     | #848  | follow a person and present to the board                               | —                     |
| 2     | #850  | decide the public API, its access tokens and webhooks                  | decision, ADR first   |
| 3     | #846  | named and automatic snapshots of a board with a history panel          | #845                  |
| 3     | #849  | a workshop agenda that runs the timer and moves everybody to the frame | #848                  |
| 3     | #851  | personal access tokens with scopes                                     | #850                  |
| 4     | #847  | restore a snapshot or open it as a new board                           | #846                  |
| 4     | #852  | public REST API v1 with an OpenAPI description                         | #851, #846            |
| 5     | #853  | signed webhooks for board and membership events                        | #852                  |

The same order number means the PBIs do not depend on each other. Feature #843 closes with #845–#849, Feature #844 with #850–#853, and
Epic #842 with both.

## Later

- **Aspire AppHost** (#867, PR #868): waits for its decision; it gets a release milestone once accepted.
- **Checks by hand that CI cannot do:** a real Entra tenant, the Helm chart on a managed cluster, the weekly load workflow
  ([docs/roadmap.md](docs/roadmap.md#what-is-next)).
