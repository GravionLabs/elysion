# ADR 0024: Renovate, not Dependabot, for dependency updates

- Status: Accepted
- Date: 2026-10-08
- Builds on: [ADR 0002](0002-typescript-version-split.md), [ADR 0021](0021-versioning-and-releases.md)

## Context

After the repository went public, Dependabot (`.github/dependabot.yml`) opened 15 pull requests at once, several of which made no sense
for this repository: TypeScript 7 (Angular and `@nestjs/cli` need TypeScript 6, [ADR 0002](0002-typescript-version-split.md)), Node 26 in the Dockerfiles
(24 is the LTS of this repository), and one pull request per package for Actions and tools that belong together. Dependabot can group
and ignore, but it cannot tie packages together by rule, hold a major back for good, or show a dashboard. The sibling project **ariadne** already runs
Renovate with a configuration made for the same stack (Angular, pnpm, SHA-pinned Actions).

## Decision

1. **Renovate** (`.github/renovate.json5`) replaces Dependabot for npm, NuGet, the Dockerfiles and GitHub Actions. It is run from a
   workflow (`renovate.yml`, Mondays, or by hand with a dry-run option), like ariadne's, with the repository secret `RENOVATE_TOKEN`
   (pull requests opened with the default `GITHUB_TOKEN` do not start CI). `renovate-config.yml` validates the configuration in a pull request.
2. **Groups** that move together: Angular with TypeScript and `zone.js`, NestJS, Excalidraw with React, build and test tooling, types, NuGet,
   GitHub Actions. A major update is a pull request of its own with the label `major`; nothing is merged automatically.
3. **Rules that encode decisions:** `typescript` stays below 7, and the Docker `node` image below 25 until somebody changes
   the rule on purpose. The shared `GravionLabs/ci` actions follow `main` and are not touched. Actions stay pinned to a commit SHA, with the version in a comment.
4. **Commits are `chore(deps): ...`,** which `cliff.toml` leaves out of the release notes. A known vulnerability gets a pull request at once, outside the schedule
   (`osvVulnerabilityAlerts`), labelled `security`.
5. One Dependency Dashboard issue lists what is waiting.

## Consequences

- Fewer, grouped pull requests on a schedule, and the decisions about TypeScript and Node are written down where the updates are made.
- The setup needs a secret that only the owner can add (`RENOVATE_TOKEN`, a personal access token with `repo` and `workflow` scope, or a Renovate app
  installation instead). Until it is set the workflow fails and nothing is updated; the failure is visible in Actions.
- GitHub's own **Dependabot alerts** (and security updates, if switched on in the settings) are separate from `dependabot.yml` and may still open
  a pull request for a vulnerability; switch security updates off in the repository settings if Renovate's `security` pull requests are enough.
