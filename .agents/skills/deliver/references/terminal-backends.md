# Terminal backends and the progress display

The deliver scripts call the terminal only through `scripts/TerminalBackend.ps1`. `Get-TerminalBackend` picks the backend: `DELIVER_TERMINAL_BACKEND` (`herdr`, `poimen`, `none`) wins; else `POIMEN_TERMINAL_ID` and `POIMEN_SOCKET` set: `poimen`; else `HERDR_ENV=1`: `herdr`; else `none`. `none` and an unsupported operation are no-ops with one notice per run on stderr; a failing backend call never fails the loop.

| Function               | herdr                                                                            | poimen                                                                       | Unsupported  |
| :--------------------- | :------------------------------------------------------------------------------- | :--------------------------------------------------------------------------- | :----------- |
| `Set-LoopTokens`       | `herdr pane report-metadata <pane> --source deliver --token k=v … --ttl-ms`      | `poimen-server report tokens --source deliver --ttl <s> k=v …`               | none         |
| `Clear-LoopTokens`     | `herdr pane report-metadata <pane> --source deliver --clear-token <name> …`      | `poimen-server report clear --source deliver` (all tokens of the source)     | none         |
| `Set-LoopAgentState`   | `herdr pane report-agent <pane> --state … --source deliver-loop --agent deliver` | `poimen-server report agent --state … --source deliver-loop --agent deliver` | none         |
| `Clear-LoopAgentState` | `herdr pane release-agent <pane> --source deliver-loop --agent deliver`          | `poimen-server report agent --release --source deliver-loop --agent deliver` | none         |
| `New-LoopWorkspace`    | `herdr workspace create`, `tab rename`, `pane run`                               | notice only                                                                  | poimen, none |
| `Open-LogPane`         | `herdr pane list`, `pane split`, `pane run`, `pane rename`                       | notice only                                                                  | poimen, none |
| `Switch-LogPane`       | `herdr pane list`, `pane close` or `Open-LogPane`                                | notice only                                                                  | poimen, none |

The tokens `deliver`, `deliver_step`, `deliver_pr`, `deliver_progress` (`<closed>/<total>` of the milestone, e.g. `7/19`) and `deliver_tone` go through `Set-LoopTokens`, the lifecycle through `Set-LoopAgentState`; the loop sends events and its terminal sink (below) makes these calls, `Clear-LoopTokens` removes all five with `run.finished`. poimen gets the same tokens and state through `poimen-server` (`terminal.report_tokens`); a missing server or method warns once on stderr (`Invoke-Poimen`) and the loop goes on. The status file `.agents/deliver-loop/status.json` is written whatever the backend (`loop.md` "Observability").

## Terminal sink of Report-Progress (deprecated)

Deprecated (ADR 0002): the sink, the owner rule (`AGENT_EVENTS_TERMINAL`) and `Set-LoopTokens`/`Set-LoopAgentState` (with their `Clear-*` counterparts) are removed in v3.4.0, the minor release after the one that marks them. Until then `DELIVER_TERMINAL_SINK=0` switches the sink off (unset or any other value keeps it); the events are written the same either way. Use the herdr event watcher (herdr-plugins, GravionLabs/herdr-plugins#221) or poimen's event reader (poimen#480) instead.

After appending, `scripts/Report-Progress.ps1` shows the event through the same functions, so herdr and poimen get tokens and state in interactive sessions too.

The mapping from events to tokens and agent state is checked in as token fixtures, not as a table here (ADR 0002): `test/skills/delivery/fixtures/progress-events/<case>.tokens.json` next to `<case>.jsonl` holds, per event `seq`, the five tokens after it (a cleared token is `null`), the agent state (`working`, `blocked`, `idle`, `released`) and the pane (`host.herdrPane` of `run.started`); an abandoned run ends with an entry that clears all five and releases the agent. The format is `schema/progress-tokens.schema.json`. `test/skills/delivery/progress-tokens.test.ts` feeds every fixture through this sink (`Report-Progress.ps1 -SinkEvent`), so sink and fixtures cannot drift; a token reader such as the herdr plugin tests against the same fixtures. A new event type or token comes with a fixture.

`deliver_tone` is `neutral`, `info`, `success`, `warning` or `danger` (the tone of the event). Only the outermost emitter reports: the process that writes `run.started` prints `AGENT_EVENTS_TERMINAL=owner` next to `AGENT_EVENTS_RUN` and reports; an emitter that has a run but no `owner` value (a nested one) skips the sink, so the owner overrides or unsets the variable for the processes it starts. The owner (whoever wrote `run.started`) must export `AGENT_EVENTS_RUN` and `AGENT_EVENTS_TERMINAL=owner`; a session that exports only the run id counts as nested. A session without a run owner (`AGENT_EVENTS_RUN` unset, interactive `/deliver`) reports itself. The agent state follows `Test-LoopAgentConflict` (no report in a pane with another agent). Backend `none` or a failing call: no-op, the event is written anyway.

Only `Test-LoopAgentConflict` (`herdr pane get`, herdr only) reads state. The sections below describe herdr.

The session does not call herdr itself: `SKILL.md` sends every progress line through `scripts/Report-Progress.ps1`, whose sink (above) sets the tokens. When `scripts/Invoke-DeliverLoop.ps1` started the session it owns the display (`references/loop.md`).

## Sidebar layout

The tokens never replace the agent name: the sidebar keeps showing the harness (`claude`, `opencode`). herdr keeps them per source for the TTL (one hour), so a crashed run does not leave them forever.

The Agent sidebar shows a token only where one of its rows names it as `$<name>`. Every repository is its own herdr space (`workspace`) with the tabs `agent` and `terminal`. The proposed layout starts with the space and its state, then the agent and its terminal title (Claude Code writes its current topic there), and the `deliver` tokens last (propose it, never write it):

```
● herdr-plugins · idle
  claude · Fix login race
  #121 · merged · #139
```

```toml
[ui.sidebar.agents]
rows = [
  ["state_icon", { token = "workspace", bold = true }, { token = "state_text", rules = [{ equals = "done", fg = "#5f5" }, { equals = "blocked", fg = "#f55" }] }],
  [{ token = "agent", dim = true }, "terminal_title_stripped"],
  [{ token = "$deliver", bold = true }, { token = "$deliver_step", rules = [{ contains = "blocked", fg = "#f55" }, { contains = "merged", fg = "#5f5" }] }, "$deliver_pr"],
]
```

Alternatives: `["agent", "pane"]` in row 2 when a space holds several agent panes, a compact two-line layout (the `$deliver` tokens share row 2 with `agent`, no terminal title), the `deliver` line first (move the third row to the top), or `row_gap = 1` under `[ui.sidebar.agents]` for air between the rows.

A herdr plugin can filter panes on the `deliver` token of source `deliver`.

## Agent state

Besides the tokens, `Invoke-DeliverLoop.ps1` reports the pane state (`herdr pane report-agent --source deliver-loop --agent deliver --state working|blocked|idle`, then `release-agent`), so the sidebar does not show `idle` while the loop delivers. Details in `loop.md` "Observability". Start the loop in its own pane: in a pane with another agent the loop reports nothing (see below).

## Log pane toggle

`scripts/Switch-LogPane.ps1` toggles the `deliver-log` pane of the active tab. The loop opens that pane itself only with `-LogPane`; by default it colors its own console output, and this toggle shows the log from another pane. herdr has no hide, so it closes the pane, and opens it again below the active pane (last 40 lines of `.agents/deliver-loop.ansi.log` under the pane's cwd, else `.agents/deliver-loop.log`). Never two in one tab; no log or outside herdr: no pane, exit 0. A keybinding for the user's herdr config (propose it, never write it; `<skill dir>` is the installed `deliver` skill):

```toml
[[keys.command]]
key = "prefix+l"
type = "shell"
command = "pwsh -NoProfile -File <skill dir>/scripts/Switch-LogPane.ps1"
description = "toggle deliver log"
```

`type = "shell"` runs detached from the focused pane's cwd with `HERDR_ACTIVE_TAB_ID`, `HERDR_ACTIVE_PANE_ID` and `HERDR_ACTIVE_PANE_CWD` set; these count as in herdr even without `HERDR_ENV`. With a herdr plugin, `type = "plugin_action"` takes its place and the script reads `HERDR_TAB_ID` and `HERDR_PANE_ID` (with `HERDR_ENV=1`).

The allowlist entry for `Report-Progress.ps1` is in `references/permissions.md`.

## Verified against a live herdr

Checked 2026-11-04 in a spare workspace (closed afterwards) with the herdr CLI of this machine:

- `herdr workspace create --cwd <dir> --label <l> --no-focus` returns `result.tab.tab_id` and `result.root_pane.pane_id` (also `workspace.workspace_id`); `Start-LoopWorkspace.ps1` reads exactly these. `herdr tab rename <tab> <label>` and `herdr pane run <pane> "<command line>"` work as used.
- `report-agent` and `release-agent` take the pane id as a positional. `report-agent --source … --agent … --state … <pane>` works, but `release-agent --source … --agent … <pane>` fails with `unknown option: deliver-loop`; `release-agent <pane> --source … --agent …` works. The loop therefore puts the pane id right after the subcommand for both.
- Another agent in the pane: `report-agent` from a second source replaces the shown agent and state, and `release-agent` of that source does not restore the first one (the pane showed `unknown`). So the two compete. `herdr pane get <pane>` has an `agent` field; the loop reports only when it is empty or `deliver`, otherwise it prints one step line and stays silent.
- Not verified: a real agent process detected by herdr (a second `report-agent` source stood in for it), and Ctrl+C of a live loop (covered by `finally` and the error-path test).

## Quoting for the pane shell

`Start-LoopWorkspace.ps1` quotes the command line for the shell of the new pane: POSIX single quotes for sh, bash, zsh, dash, ksh and fish; doubled single quotes for pwsh and powershell. The shell is `-PaneShell`, else `DELIVER_LOOP_PANE_SHELL`, else the name of `$SHELL` (Windows: pwsh, elsewhere unset: sh). Any other shell (cmd, nu, …) fails before herdr is called with a message, and the shim then runs the loop in the current terminal.
