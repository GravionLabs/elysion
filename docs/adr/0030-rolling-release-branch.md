# ADR 0030: A rolling release branch, release milestones and a roadmap of the order

- Status: Accepted
- Date: 2026-10-31
- Amends: [ADR 0021](0021-versioning-and-releases.md)
- Builds on: the release model of [GravionLabs/skills](https://github.com/GravionLabs/skills) (`github-release`, `deliver`)

## Context

Since 0.1 every release had a branch of its own (`release/0.1` … `release/0.4`), cut by hand, written into each feature issue and merged into
`main` once. The milestones were phases (`M1 Foundation` … `M16 Workshops and integrations`), not releases, and `docs/roadmap.md` tells what
each phase brought, not the order in which the open issues are worked on. The ruleset on `release/**` required only the `ready` check, so a
pull request with red CI could be merged into a release branch.

The owner wants to deliver PBIs with the `deliver` skill of GravionLabs/skills. It expects the release model of that repository: one rolling
branch `release/next`, a GitHub milestone per release, and a ruleset whose required checks are the gate, because the merges are made by an agent.

## Decision

1. **One rolling branch `release/next`** replaces `release/<x.y>`. It is cut from `main` (`github-release cut`), every PBI branch
   (`<type>/<nr>-<slug>`) is cut from it and squash-merged back, and it is merged into `main` once per release with a merge commit. After that
   merge it is recreated from `main` by the next `cut`, never continued. A hotfix goes to `main` and `main` is then merged into `release/next`.
2. **The release pull request** is kept open and current by `.github/workflows/release-branch.yml` (the reusable `release-branch.yml` of
   GravionLabs/ci), which also labels the issues merged into the branch `merged`. `github-release finish` adds the `+semver: minor` commit;
   the owner merges.
3. **The ruleset on `release/**`** requires the CI jobs (`Format, lint, test, build`, `.NET coverage`, `BFF and realtime e2e, coverage`, the
   four `Scan` jobs, `Dependency audit`) besides `ready`. The owner keeps the bypass for the `+semver` commit.
4. **Milestones are releases.** The open milestone `M16 Workshops and integrations` becomes `0.5.0`; later releases get the next version as
   their name. `GitVersion.yml` sets `next-version: 0.5.0` (the tags so far are all `0.1.0-beta.N`) and gives `release/next` the `Minor`
   increment. `main` keeps the label `beta`, so the release is `0.5.0-beta.N`, a pre-release, as in [ADR 0021](0021-versioning-and-releases.md).
5. **`ROADMAP.md` at the root** gives the order of the open PBIs of the current release, their dependencies and decisions, like the roadmap of
   GravionLabs/skills. `docs/roadmap.md` stays the history of what was built, on the documentation site, and links to it.

## Consequences

- `/deliver <nr>` and `/deliver --milestone 0.5.0` work on this repository; a red required check blocks the merge whatever the agent does.
- `release/0.1` … `release/0.4` are not used any more; the owner deletes them (`git push origin --delete release/0.4` and so on), the released
  ones are in the history of `main`.
- Every pull request into `release/next` waits for the whole CI, including the image scans. A flaky or slow job now blocks the merge.
- The `Phase` field of the project board and the M1–M15 milestones stay as history; new issues get a release milestone.
