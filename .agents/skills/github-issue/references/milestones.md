# Milestones and the issue levels

A milestone is a roadmap entry of Features and the record of what a release shipped ([ADR 0010](https://github.com/GravionLabs/skills/blob/main/docs/adr/0010-milestones-hold-features-as-a-roadmap-and-record-what-a-release-shipped.md)). The rule is written here once; `planner`, `roadmap`, `deliver` and `github-milestone` follow and check it. Its title is `M<nnn>` (three digits, `M001` to `M999`; the lookup accepts `M11` for `M011`), see `github-milestone`. How milestones fit the path from Objective to release: [delivery model](https://gravionlabs.github.io/skills/delivery/model).

| Level     | Milestone                                                                                                        |
| :-------- | :--------------------------------------------------------------------------------------------------------------- |
| Objective | Never (it spans repos and releases).                                                                             |
| Epic      | Never.                                                                                                           |
| Feature   | Planned: the release it is meant to ship in (rough roadmap), or none. Moves when its last PBI ships later.       |
| PBI       | Not planned. Set at merge into `release/next` by GravionLabs/ci `release-branch.yml`: the milestone it ships in. |
| Bug       | Not planned, also without a parent Feature (urgency is a label). Set at merge, like a PBI.                       |

A `release-test` is the exception: it is created in its milestone and stays there.

Why: planning the work is the job of Objectives and Features, and what a release ships is decided by what is merged into `release/next`. So a milestone grows only by merges, planning a follow-up needs no new milestone, and its closed PBIs and Bugs are what shipped. The open work of a release is shown by the Features of the milestone: `deliver --milestone` takes the open PBIs and Bugs below those Features, plus the open PBIs and Bugs still in the milestone from before the migration.

## Setting a milestone

Only `github-milestone assign M<nnn>|none #<nr> …` sets or clears the milestone of issues (`scripts/Get-Milestones.ps1 -Mode assign`; `-DryRun` writes nothing). Never set one by hand: the milestone flags of the `gh` issue-edit call (`--milestone`, `--remove-milestone`) are not used in any skill, because they skip the checks below and the report. `assign` takes an open milestone only (a missing `M<nnn>` is not created: `create` first), refuses an Epic or an Objective, and a PBI or Bug that is no `release-test` (except `none`; `-Force` sets a PBI or Bug for repairs), and reports each change as `set`, `forced` or `unchanged`. A Feature created by `github-issue` `references/create-from-plan.md` gets its milestone this way; a PBI or Bug created there gets none.

## Release test

One `release-test` per milestone (label `pbi` + `release-test`, usually `interactive`): the manual platform test on the release candidate. Rule: one `release-test` per milestone, always last, never a gate unless `release.test.gate` is true (then the RC test blocks the release; see `release-review.md`, `project-config.md`). `deliver` never selects it as work: step 9 cuts the RC once no other `pbi`/`bug` of the milestone is open and posts it on the release-test issue, which stays open for the human (`select: release test, left for step 9`; with open items before, `release test, waits for <n> open items`); `interactive` stays on it.

RC of a desktop app (Tauri): every RC and beta build has its own identifier `<identifier>.rc`, product name `<Name> RC`, its own runtime, config and data paths and no auto-update, so it installs side by side with the stable build. The release test installs that RC next to the stable app and never runs on a `tauri dev` build; update checks run on the stable app only.

## Closing

An issue closes when its PR is merged into `release/next` (comment "ships with <milestone>", `release-branch.yml` of GravionLabs/ci), also its PBI or Feature parent once all sub-issues are closed; an Epic is never closed this way, an Objective is closed by a human only (`objectives.md`). `close-release-issues` (GravionLabs/ci) is the safety net when the release lands on `main`. "Released" means a closed milestone (`github-milestone close`), not a label. A reverted PR: reopen its issues by hand (`github-release` `references/closing.md`).

## Checks

- An Epic or an Objective in a milestone breaks the rule: `github-milestone assign` refuses both (except `none`), `roadmap` (`Set-IssueMilestones.ps1`) assigns through it. Fix it by clearing the milestone.
- A Feature whose PBIs sit in other milestones or in none is the normal case, no warning. A PBI or Bug without a milestone is normal until it is merged.
- An open PBI or Bug still in a milestone from before the migration is allowed; it stays workable until the migration (`github-milestone migrate`) clears it.
- GravionLabs/ci: `project-needs.yml` (nightly, mode `project`) and `issue-events.yml` (on milestoned and demilestoned events) run `Sync-ProjectNeeds.ps1`, which checks the Current and Milestones fields of the project against the issues' milestones; it does not check the milestone rule itself.
