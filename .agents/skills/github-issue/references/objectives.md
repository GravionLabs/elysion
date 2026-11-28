# Objectives

An `[Objective]` (label `objective`) is the level above the Epic, an outcome that spans several Epics or Features, also in other repositories of the same owner. It names the outcome, never the implementation. How an Objective becomes releases: [delivery model](https://gravionlabs.github.io/skills/delivery/model).

## Body

- `## Outcome`: what is true when it is done.
- `## Affected repos`: `<owner>/<repo>` list.
- `## Requires`: one line per prerequisite, see below.
- `## Acceptance Criteria`: a checklist a human verifies.
- Children are native sub-issues (Features or Epics, `sub-issues.md`), not a checklist. No implementation details.
- Planned with `planner <owner/repo#nr>`: Features in the target repositories, created and linked by `create-from-plan.md`.

## Requires

One of two forms:

`Requires: <owner>/<repo>@<milestone> released|rc`

`Requires: <owner>/<repo>#<feature>`

- `#<feature>`: the Feature is closed and the release that shipped its last PBI is tagged.
- `released`: the milestone is closed (`github-milestone close`).
- `rc` (the normal case): the `release-test` issue of the milestone carries the marker `<!-- release-test-rc -->`.
- Code dependencies between issues stay native `blocked-by` links, never `Requires`.
- An invalid `<owner>/<repo>` (not two segments of letters, digits, `.`, `_`, `-`, and neither `.` nor `..`; #574) is not used: the line is dropped, the other `Requires:` lines still count.

## Closing

When all children are closed, a human checks the Acceptance Criteria and closes the Objective. No skill closes it.

## Milestones

An Objective never has a milestone (`milestones.md`, [ADR 0010](https://github.com/GravionLabs/skills/blob/main/docs/adr/0010-milestones-hold-features-as-a-roadmap-and-record-what-a-release-shipped.md)); `github-milestone assign` refuses it like an Epic.
