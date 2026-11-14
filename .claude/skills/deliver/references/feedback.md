# Feedback during a run

In an interactive run (control session or `--inline`) the user reports what they see: manual test findings, UI wishes, ideas. This session turns each into an issue in the milestone and implements nothing itself.

## Capture

1. A message that describes a defect or a change is a finding. One message with several findings gives one draft per finding. Screenshots and files the user names are referenced in the body (path or link), not described from memory.
2. Per finding a draft, shown in at most 6 lines: type (`[Bug]` or `[PBI]`), title (`fix: …` or `feat: …`), repro (Bug) or acceptance criteria (PBI), `Tier:` and `Size:`.
3. Ask once for confirmation of all drafts together. Unattended there is no user, so this never runs.
4. On confirmation create each with `github-issue` (title `[<Level>] <summary>`, label `bug` or `pbi`) in the current milestone (the `milestone.title` of step 1) or the one the user names. Print the URL per issue.

## Ready or refine

- Small and clear (Size S, criteria testable, no open decision): no `needs-refinement`. The next selection (step 1) of the same run picks it up, or the loop does on its next PBI.
- Unclear (open question, Size L, unknown cause): label `needs-refinement` and the hint `planner refine <nr>`; selection skips it.

## No implementing here

The control session never changes code for feedback. "Fix it now" from the user: create the PBI as above, deliver it with steps 2 to 8 (subagents, review, PR, CI, merge), report the PR as usual.
