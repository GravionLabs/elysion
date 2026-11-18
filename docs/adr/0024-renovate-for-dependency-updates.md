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
   workflow (`renovate.yml`, Mondays, or by hand with a dry-run option), like ariadne's, with a token of the GravionLabs CI app (repository secrets `CI_APP_ID` and `CI_APP_PRIVATE_KEY`, #914; before that a secret `RENOVATE_TOKEN`
   that was never set; pull requests opened with the default `GITHUB_TOKEN` do not start CI). `renovate-config.yml` validates the configuration in a pull request.
2. **Groups** that move together: Angular with TypeScript and `zone.js`, NestJS, Excalidraw with React, build and test tooling, types, NuGet,
   GitHub Actions. A major update is a pull request of its own with the label `major`; nothing is merged automatically.
3. **Rules that encode decisions:** `typescript` stays below 7, and the Docker `node` image below 27 (Node 26, the LTS since October 2026; it was 25 while Node 24 was the line) until somebody changes
   the rule on purpose. The shared `GravionLabs/ci` workflows and actions follow the major tag `@v1` (#914; `main` before) and are not pinned. Every other action stays pinned to a commit SHA, with the full version in a comment.
   The shared preset `github>GravionLabs/ci` holds a release back for 7 days (#914; security fixes exempt), and `minimumReleaseAge` in `pnpm-workspace.yaml` does the same for an install.
4. **Commits are `chore(deps): ...`,** which `cliff.toml` leaves out of the release notes. A known vulnerability gets a pull request at once, outside the schedule
   (`osvVulnerabilityAlerts`), labelled `security`.
5. One Dependency Dashboard issue lists what is waiting.

## Consequences

- Fewer, grouped pull requests on a schedule, and the decisions about TypeScript and Node are written down where the updates are made.
- The setup needs secrets that only the owner can add (`CI_APP_ID` and `CI_APP_PRIVATE_KEY` of the GravionLabs CI app since #914). Without them the
  workflow fails and nothing is updated; the failure is visible in Actions.
- GitHub's own **Dependabot alerts** (and security updates, if switched on in the settings) are separate from `dependabot.yml` and may still open
  a pull request for a vulnerability; switch security updates off in the repository settings if Renovate's `security` pull requests are enough.
