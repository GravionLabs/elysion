# Definition of ready per level

`refine <nr>` checks the issue against the list of its level. A point is met when the body (or, for children, the sub-issues) states it concretely; only the missing points go to `grill-me`. Facts the code answers are looked up, not asked.

with `governance`: also `references/governance.md`

Milestone points follow [ADR 0010](https://github.com/GravionLabs/skills/blob/main/docs/adr/0010-milestones-hold-features-as-a-roadmap-and-record-what-a-release-shipped.md) (`github-issue` `references/milestones.md`).

## Objective

`refine <owner/repo#nr>` of an `[Objective]` (`github-issue` `references/objectives.md`); the children are read across the affected repositories.

- Outcome present (`## Outcome`).
- Every repository of `## Affected repos` has at least one child (Feature or Epic) as sub-issue.
- Acceptance criteria present as a checklist a human verifies.
- No implementation details in the body.
- Every child issue that pulls in a pin (`SOURCE.txt`, a tag in a dependency) has a `Requires: <owner>/<repo>#<feature>` or `Requires: <owner>/<repo>@<milestone> released|rc` edge, in the child or in the Objective's `## Requires` (a code dependency stays a native `blocked-by` link). A pin without an edge is a gap.
- No milestone on the Objective.

## Epic

- Outcome: what is true when the Epic is done.
- Scope and out of scope.
- Features as sub-issues.

## Feature

- Goal.
- Acceptance criteria, testable.
- PBIs as sub-issues with blocked-by links.
- Milestone: the release it is planned for, or none.

## PBI

- No milestone (set at merge).
- Testable acceptance criteria.
- `## Current behavior` and `## Desired behavior`, stated as behavior (not as steps).
- Files and symbols named, never line numbers (the body must stay valid while the code moves).
- Where the tests go: a `Tests: <seam>` line naming the public interface.
- `## Out of scope`.
- Size S or M (size L: split, see `## Refine` in `SKILL.md`).
- A `Tier: <tier> — <reason>` line (`refine` adds a missing one, `SKILL.md` `## Refine`).
- `## Protected paths` passes.

## Bug

All PBI points (no milestone included), plus repro steps or a failing test to write first.

## Protected paths

The check is mechanical: `<skill-dir>/scripts/check-protected.mts` matches the files of each item with `deliver.protectedPaths` of the repository, else `protected-paths.json` of the `deliver` skill (`slicing.md`, "Protected paths").

```powershell
node <skill-dir>/scripts/check-protected.mts --plan <plan.json> --root <repository> [--fix]
```

- Plan: write the plan to a temporary file outside the repository and pass it.
- `refine`: there is no plan; write `{"items":[{"id":"#<nr>","body":"<body>","files":[…],"labels":[…]}]}` with the files the body names and the exploration finds, and the labels of the issue.
- Exit 1 (`error:`): a hit without the label `interactive`, or Technical Notes that do not name the protected file. The item is not ready and is not created. `--fix` adds both to the file; then split the change per `slicing.md` and write label and body to the plan or issue. `refine --check` never writes: the error makes `ready` false and becomes a question.
- A manifest whose change is dependencies only passes when the Technical Notes carry the line `Dependency-only: <path>, …` (paths as in `files`). Write it only when no other key of the manifest changes.
- `warning:` (no files listed): look the files up and list them; report it when it stays.

## Milestone

`refine M<nnn>`: read the open PBIs and Bugs of the milestone (`github-milestone` `Get-Milestones.ps1 -Mode issues`). Per item without a `Tier:` line add `Tier: <tier> — <reason>` (size table of `plan-schema.md`), then report `#<nr> Tier: <tier> — <reason>` for each changed item and `unchanged` for the rest.
