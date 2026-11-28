# Closing the milestone after the release (finish step 5)

The release job of GravionLabs/ci (`close-milestones`) normally closes the milestone after the tag; this is the repair path for a milestone it left open. Runs in the later `finish` on the merged branch, after `fast-forward`. The publish check (step 1) always runs; the steps after it need `github-milestone` installed (`../github-milestone/scripts/Get-Milestones.ps1`), otherwise stop after the fast-forward as before.

1. Publish check: `gh pr view <release PR> --json mergeCommit --jq .mergeCommit.oid`, then `pwsh scripts/Get-PublishState.ps1 -Sha <oid> -Wait -Rerun` (waits at most 30 min: run it in the background or with a longer tool timeout). Exit 0 (`ok`): `git fetch --tags`, the tag `v<x.y.z>` is `tag` of the JSON. Exit 1 (`failed`, also after the one re-run, or tag or GitHub Release missing): stop with exit 1, report the run URL and the failed job, the milestone stays open. Exit 2 (`pending`): report "release job still running" and stop. Exit 3: report that `gh` could not be read and stop.

   The script writes an agent-events run (`run.started`, one `ci.run.completed` per workflow run, `ci.publish.ok` or `ci.publish.failed`, `run.finished`; profile `ci@1`, fields under `ci`: `schema/ci-profile.schema.json`) into `-Events <dir>`, else `AGENT_EVENTS_DIR`, else the per-user directory (`$XDG_STATE_HOME/agent-events/`, else `~/.local/state/agent-events/`; Windows `%LOCALAPPDATA%\agent-events\`), with `origin` in `run.started`.

2. Version check: `pwsh scripts/Test-ReleaseVersion.ps1 -Tag v<x.y.z>` (read-only JSON: `expected`, `match`, `bump`, `deciding[]`). `match` false: report tag, `expected` and the `deciding` commits (for example a `feat:` that should have made a minor release), then stop. Nothing is renamed or closed with a wrong version.
3. Milestone: `Get-Milestones.ps1 -Mode list`; the lowest open `M<nnn>` or, legacy, the open `x.y.z` with `tagged: true`. None: skip to the report.
4. Leftovers: `Get-Milestones.ps1 -Mode issues -Name <milestone>` lists the open issues of the milestone. PBIs and Bugs among them whose PR is merged into the released branch (missing `Closes`) are the unclosed ones.
5. Confirmation: one question that lists the leftovers to close, the issues `--move-to` moves and the next milestone name. With `--yes` ask nothing. A fork without `--yes` never asks: it reports the plan and the commands and does steps 6 to 8 only with `--yes`.
6. `Get-Milestones.ps1 -Mode create` for the next `M<nnn+1>` (skip when it exists); legacy: the next `x.y.z`.
7. Close the unclosed PBIs/Bugs before the move: `gh issue close <nr> --comment "Released in v<x.y.z>"`.
8. `Get-Milestones.ps1 -Mode close -Name <milestone> -Version <x.y.z> -MoveTo <next>` (a plain close without open issues).
9. Report: the closed milestone with its new title, issues closed and moved, the next milestone with the count of its ready issues (`-Mode issues`, group ready) and the hint to cut `release/next` (`/github-release cut`).
