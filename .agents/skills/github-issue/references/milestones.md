# Milestones and the issue levels

A milestone is a release and holds the work items that are delivered. The rule is written here once; `planner`, `roadmap`, `deliver` and `github-milestone` follow and check it.

| Level   | Milestone                                                          |
| :------ | :----------------------------------------------------------------- |
| PBI     | Always: the milestone it is delivered in.                          |
| Bug     | Always: the milestone it is delivered in.                          |
| Feature | Only when all its PBIs are in that same milestone, otherwise none. |
| Epic    | Never.                                                             |

Why: `deliver --milestone` takes the open PBIs and Bugs of the milestone plus the work items below the Features in it. A Feature in the milestone with PBIs outside of it pulls those in, and they then do not count in the milestone progress. `deliver` therefore skips such an item (`#<nr> select: outside M<n>, skipped`); `/deliver <feature>` without `--milestone` delivers all its PBIs as before.

## Release test

One `release-test` per milestone (label `pbi` + `release-test`, usually `interactive`): the manual platform test on the release candidate. Rule: one `release-test` per milestone, always last, never a gate unless `release.test.gate` is true (then the RC test blocks the release; see `release-review.md`, `project-config.md`). `deliver` never selects it as work: step 9 cuts the RC once no other `pbi`/`bug` of the milestone is open and posts it on the release-test issue, which stays open for the human (`select: release test, left for step 9`; with open items before, `release test, waits for <n> open items`); `interactive` stays on it.

## Closing

An issue closes when its PR is merged into `release/next` (comment "ships with <milestone>", `release-branch.yml` of GravionLabs/ci), also its PBI or Feature parent once all sub-issues are closed; an Epic is never closed this way. `close-release-issues` (GravionLabs/ci) is the safety net when the release lands on `main`. "Released" means a closed milestone (`github-milestone close`), not a label. A reverted PR: reopen its issues by hand (`github-release` `references/closing.md`).

## Checks

- `github-milestone` `current` and `<name>` list a `warnings` group: an Epic in the milestone; a Feature in it with open sub-issues outside of it (with their milestone or `none`).
- `roadmap` (`Set-IssueMilestones.ps1`) refuses an Epic and a Feature whose open PBIs would not all be in its milestone; nothing is written then.
- Fix a warning by moving the PBIs into the milestone or clearing the milestone of the Feature or Epic.
