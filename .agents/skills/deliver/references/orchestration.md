# Models of the sessions an orchestrator starts

An orchestrator is a session that starts other sessions: subagents, poimen panes, loops. A subagent or pane started without a model inherits the orchestrator's model. So before every start it resolves the model of the role and passes it.

## Resolve, then pass

```powershell
node <deliver-skill-dir>/scripts/resolve-model.mts <role> [--tier <fast|standard|strong>] [--harness <claude|copilot>]
```

- Run it in the checkout of the repository the session will work in: its `.agents/config.json` wins over `~/.agents/config.json`.
- `--harness` is the one of the new session (default `claude`).
- The output is the model. Claude Code agent call: pass it as `model`. poimen `start_agent`: pass it as `model`.
- The loop (`deliver-loop.mts`) resolves the model of its own sessions. Pass `--model` or `--review-model` only to override the config.
- Exit 64 (wrong role, tier or config): fix the cause. Do not start the session without a model.

## Roles of the orchestrator's own starts

| Start                      | Role        | Tier                                   |
| :------------------------- | :---------- | :------------------------------------- |
| Interactive PBI            | `implement` | the `Tier:` line of the PBI (`--tier`) |
| Independent review of a PR | `review`    | of the role                            |
| Release                    | `release`   | of the role                            |
| Planner pane               | `planner`   | of the role                            |
| Docs change                | `implement` | `--tier fast`                          |

A PBI without a `Tier:` line: no `--tier` (`standard`). "Of the role": no `--tier`, the config decides.

`deliver-loop --objective` (Feature [GravionLabs/skills#1041](https://github.com/GravionLabs/skills/issues/1041), not built yet) uses the same resolver for the sessions it starts.

## Start prompt template of an Objective run

Drawn from the orchestrated run of GravionLabs/helix#1204. Fill the `<…>` parts and give it to the orchestrator session.

```text
Orchestrate the run of the Objective <owner>/<repo>#<nr>.

Scope: <repositories>. Not in this run: <issues>.
Order: waves; a repository starts after the releases it requires. Re-read each milestone before its release.
Work: deliver-loop per milestone; interactive PBIs, reviews, releases and planning in sessions you start.
Log: one comment on the Objective, first line <!-- objective-run: <repo>#<nr> -->, edited after each step:
waves with status, log, "Needs the owner".
Authorization: <what the owner allows, for example: merge an interactive PR after an independent review with
green checks>. Release PR merges, protected paths, risk high and decisions between options go to the owner.

Models: never let a session inherit your model. Before each start, run
node <deliver-skill-dir>/scripts/resolve-model.mts <role> [--tier <t>] [--harness <h>]
in the checkout of that repository and pass the output as `model` (agent call, poimen start_agent).
- interactive PBI: implement --tier <Tier: line of the PBI; none: omit --tier>
- independent review: review
- release: release
- planner pane: planner
- docs: implement --tier fast
Start deliver-loop without --model and --review-model unless you mean to override the config.
```
