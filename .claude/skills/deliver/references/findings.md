# findings.json for poimen

After every review round of step 4, next to `review-<nr>.json`, this session writes the findings for poimen.

1. Save the subagent result plus `unmet[]` as one JSON object (`{ blocking, notes, unmet }`) in a temporary file.
2. `pwsh <skill-dir>/../code-review/scripts/ConvertTo-Findings.ps1 -Review <file> -Sha <sha of origin/<branch>> -Worktree <pbi-worktree>`.

The script writes `<pbi-worktree>/.agents/state/findings.json` (`source` = `deliver`) and, when `.agents/state/` is not ignored, appends it to `<git-common-dir>/info/exclude`, so the file is never committed. Mapping: `blocking[]` is severity `blocking` with location, `unmet[]` is `blocking` without location, `notes[]` is `note` without location. The next round overwrites the file.
