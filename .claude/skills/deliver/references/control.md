# Control session over the loop

An interactive run over many PBIs keeps its own context small: the PBIs are delivered by `Invoke-DeliverLoop.ps1` (`references/loop.md`), one fresh session each, and this session only watches, asks and releases.

## When

Interactive (no `--unattended`), no `--inline`, and the selected set (step 1) has more PBIs than the threshold `deliver.loopThreshold` in `.agents/config.json` (default 3) after `--max` is applied: always for `--milestone`, for Feature and Epic targets once they exceed it. Otherwise (a few PBIs, `--inline`, `--unattended`) the session delivers them itself, steps 2 to 8. A loop that is already running on the same targets (a fresh `.agents/deliver-loop/latest.txt` run without a `result` record) is watched, not started twice.

## Start

1. Step 1 (Select) runs here, read-only: count the PBIs, list the `interactive` ones (they stay with this session) and the paused ones.
2. Start the loop in the background with the same targets and `--max`: the shim `deliver-loop` (`pwsh <skill-dir>/scripts/Invoke-DeliverLoop.ps1` without it), `-Harness` the harness of this session (`claude`, `copilot`), no `-Model` unless the user passed one (the loop then picks the model per PBI from its tier, `references/roles.md`; `copilot` picks `auto`). In herdr (`HERDR_ENV=1`) the shim opens its own workspace; elsewhere run it with the harness's background shell. Print `loop: started, log .agents/deliver-loop.log`.
3. Claims (`references/claim.md`) keep this session and the loop from delivering the same PBI.

## Watch

Read `.agents/deliver-loop/latest.txt` (path of the newest run) and its `progress.jsonl`, one JSON object per line:

| `event`           | Fields                                                                                   |
| :---------------- | :--------------------------------------------------------------------------------------- |
| `start`           | `targets`, `milestone`, `max`, `harness`, `model`, `open`                                |
| `iteration-start` | `n`, `total`, `pbi`, `open`, `model`                                                     |
| `iteration-end`   | `n`, `pbi`, `delivered` (comma list), `open`                                             |
| `result`          | `result` (`done`, `max reached`, `blocked`, `no progress`), `code`, `iterations`, `open` |

After each `iteration-end` print `#<nr> loop: <delivered or held>` and the status block (`SKILL.md`, `## Status block`, `-Delivered` the numbers delivered so far). Poll with a sleep of at least 60 s; the loop's own lines are in `.agents/deliver-loop.log`.

## Decisions

A PBI that got `needs-decision` is shown here: its question (the last `deliver paused` comment), a full URL. Ask the user, post the answer as a comment, `gh issue edit <nr> --remove-label needs-decision`, and start the loop again (it continues from GitHub). `needs-refinement` is reported with `planner refine <nr>`, not asked.

## Interactive PBIs

The loop skips `interactive` PBIs. When the loop ends (`done` with only `interactive` PBIs open, or `blocked`), deliver them (never the `release-test` issue, it stays open for step 9) in this session with steps 2 to 8, then start the loop again if PBIs became ready.

## Release

When the loop result is `done` and no `interactive` PBI is left, run step 9 once in this session (release review, release PR). The control session does not wait for the RC test: step 9 cuts the RC, opens the release PR and ends the run with `needs you: RC test` (`release.test.gate: true` keeps the old gate). `max reached`: report the delivered count and, as open PBIs remain, offer to start the loop again; never release. `blocked` or `no progress`: report it, never release.

## Context guard

`deliver.controlContextTokens` in `.agents/config.json` (default 200000). When this session's own context passes it (as the harness reports it), print the status block and the resume command (`/deliver <same arguments>`; the running loop keeps going), and stop. The next session continues from GitHub.
