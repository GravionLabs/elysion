# Preflight

Start step 3 runs `pwsh <skill-dir>/scripts/Test-DeliverPreflight.ps1 -Harness <h> [-Unattended] -Text` and prints its lines (`preflight <check>: ok | fixed | action needed - <detail>`). It takes a few seconds (one `detect-techstack` run, a few `git`/`gh` reads) and is skipped with `--no-preflight`. Without `-Text` it prints JSON `{actionNeeded, checks[]}`.

| Check       | ok when                                                                                                                                    | action needed                                                                                                            |
| :---------- | :----------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------- |
| `skills`    | every `<lang>-implementation` and `<lang>-test` of `detect-techstack` is in `.claude/skills` or `.agents/skills` and not older than global | `missing[]`, `old[]`; `fix` is `/skills-manage <langs>`                                                                  |
| `allowlist` | `git`, `gh`, `pwsh <skill-dir>/scripts/*` and the verify commands of the code blocks in `AGENTS.md` are allowed (`permissions.md`)         | `missing[]` holds the exact settings lines; `-AddAllowlist` writes them to `.claude/settings.json` resp. `opencode.json` |
| `worktrees` | no worktree of a PBI branch (`<type>/<nr>-…`, `wip-<nr>`) is left: merged PR → `Remove-PbiWorktrees.ps1`, branch gone and clean → removed  | `left[]` with path, reason and command (open branch, uncommitted changes)                                                |

Reaction to `action needed`:

- **skills**, interactive: ask once, then run `skills-manage` for the stack. Unattended: print the line and go on with the global skills.
- **allowlist**, both modes: print the lines. Interactive: offer to add them (rerun with `-AddAllowlist` after a yes). Unattended: the run continues; a prompt may stop it, so the lines go into the report.
- **worktrees**: print `left[]` and keep them for the report; they are never removed without the user.

Copilot CLI has no project allowlist file; the check reports ok and the flags of `permissions.md` apply.
