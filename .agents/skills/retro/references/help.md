# /retro

Retrospective on a finished run: measures it, ranks improvements to the agent environment (steering, checks, review rules, agents, models), drafts PBIs and lessons. Nothing is created without your approval.

## Usage

```
/retro [#<issue> | <session-id> | --run <path> | --milestone <M>]
/retro --milestone <M> --post [--release-pr <url>]
/retro --objective <owner>/<repo>#<nr> [--post]
/retro file <comment url>
/retro help
```

## Arguments and flags

- `#<issue>` (or the bare number): analyse the PRs of that issue.
- `<session-id>`: analyse that session.
- `--run <path>`: analyse that `deliver` run folder (`<git-common-dir>/deliver/<run>/`); repeatable.
- `--milestone <M>`: analyse the newest run folders with issues of that milestone; several runs merge by issue, the last result per issue wins. Adds the row `loop review: <x> changes requested, <y> escaped` with links to the escaped findings (other reviews, follow-up PBIs and Bugs, Bugs within 7 days of the release).
- `--post` (with `--milestone`): post the report as one comment with the marker `<!-- retro: <M> -->` on the Feature that holds most of the milestone's issues, else on the release PR (`--release-pr <url>`); drafts are `- [ ]` checklist items with `<details>`; a rerun edits the comment. Asks nothing and writes nothing else; the `deliver` loop runs it after a milestone.
- `--objective <owner>/<repo>#<nr>`: aggregate the milestone retros (comments `<!-- retro: <M> -->` on the Features) of every repository of the `[Objective]`, plus the Objective's own comments. One metrics line per repository (`no retro` without one), candidates that hold for two or more repositories first, marked with those repositories, each with evidence links. With `--post` one comment `<!-- retro: objective -->` on the Objective, edited on rerun. Run it when every repository is released.
- `file <comment url>`: file the ticked drafts of a retro comment that have no `filed:` note: PBIs through `github-issue` (label `retro`, created if missing), lessons as one PR per repository with `status: approved`, checked with `Get-Lessons.ps1 -Check`. An invalid lesson is reported, not filed. Each filed item gets `filed: #<nr>` or `filed: PR #<nr>`, so a rerun files nothing twice. Unticked drafts stay.
- nothing: the newest run folder; without one the skill asks for the issue number.
- `help` (also `--help`, `-h`): print this text.

What it measures (seven columns, `n/a` when there is no source, never estimated; `~` stays an estimate): cost, main peak (context), requests, roles by cost, review rounds, fix rounds, CI / duration. Sources: the run folder first, `agentlens` and `gh` for what it lacks (each column names its source). Without a run folder the report says so and uses `agentlens` and `gh`.

Output: a report of at most 40 lines (metrics table, candidates ranked by severity with evidence, escalation lines) plus a separate Mermaid flow diagram of the agent calls per PBI (order, round numbers, results; "flow not measured" without a source; it does not count towards the 40 lines), then on request:

- draft PBIs in the `github-issue` format, each naming the skill file and rule to change;
- lesson drafts with `status: proposed` for repository-, language- or role-specific candidates;
- proposals to retire approved lessons that did not help.

Drafts are shown as text. No issue, PR, file or lesson is created, edited or pushed until you approve (`--post` writes only its comment; for `file` the tick is the approval).

## Examples

```
/retro #197
/retro 197
/retro --milestone M016
/retro --objective GravionLabs/helix#1204 --post
/retro file https://github.com/o/r/issues/60#issuecomment-1
/retro --run .git/deliver/20261126T193530-28755
/retro
/retro help
```

## Config

none

## See also

- `deliver`, whose run folder supplies the metrics and escalation lines
- `github-issue`, which creates approved PBIs
- `lessons`, the contract of lesson drafts
