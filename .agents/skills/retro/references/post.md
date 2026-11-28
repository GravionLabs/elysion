# Post the retro (`--post`)

`retro --milestone <M> --post [--release-pr <url>]` posts the retro as one comment instead of showing it. The `deliver` loop runs it after the last merge of a milestone, in a session where nobody answers.

## Differences to a typed retro

- Ask nothing. Draft a PBI (step 5) or a lesson (steps 6, 7) for every ranked candidate that has evidence.
- The comment is the only thing you write outside a temporary folder. Never create or edit an issue or pull request, never push, never commit, never create a lesson file, never comment in any other way than with the script.
- Skip the approval question: a person ticks the checklist later.

## Comment

Write this to a file in a temporary folder outside the repository, at most 60000 characters:

1. The report of step 4: the metrics table, the `loop review:` row, the ranked candidates, the escalation lines.
2. `## Drafts`: one checklist item per draft, the draft in a `<details>` block under it, indented two spaces. No drafts: `No drafts.`

```markdown
- [ ] PBI: <title>
  <details>
  <summary>Draft</summary>

  <the draft: Overview, Acceptance Criteria, Definition of Done>

  </details>

- [ ] Lesson: <id>
  <details>
  <summary>Draft</summary>

  <the lesson file in a fenced block, frontmatter with status: proposed>

  </details>
```

Put every `@name` in backticks (GitHub notifies the owner). Replace secrets and personal data with `<REDACTED>`. Do not start a line of the report with `Closes #`.

## Post

```powershell
node scripts/post-comment.mts --milestone <M> --file <report.md> --release-pr <url>
```

Pass `--release-pr` only when you were given it. The script picks the Feature that is the parent of most issues of the milestone, else the release pull request. It writes the marker `<!-- retro: <M> -->` as the first line and edits its own comment on a rerun, so do not add the marker yourself. It prints the URL of the comment.

End with one line: `result: retro <url>`, or `result: blocked <reason>` when the script fails.
