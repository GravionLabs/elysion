# Roles: model and effort

The skill gives its subagents `model` and `effort` of the roles `implement`, `review`, `fix` and `release-review` (step 9, the review of the whole release diff, `references/release-review.md`) when the harness takes a model per call (Claude Code); OpenCode and Copilot CLI use the session model or their own agent config. The other roles of the table are kept in the config schema; this skill does not use them. A run of many PBIs on the session model is expensive (about 30 k context tokens per subagent before it starts), so each role has a default.

## Defaults

| Role                                   | Model              | Effort         |
| :------------------------------------- | :----------------- | :------------- |
| `select`, `create`, `gate`, `pr`, `ci` | haiku              | low            |
| `review`                               | sonnet             | medium         |
| `release-review`                       | opus               | high           |
| `plan`                                 | session model      | session effort |
| `implement`, `fix`                     | by tier of the PBI | by tier        |

Tier (`Tier:` line of the PBI body; else the size: S fast, M standard, L strong; else standard): `fast` haiku/low, `standard` sonnet/medium, `strong` opus/high.

The tier is shown before and during a run: the select line (`#<nr> select: next (tier standard → sonnet/medium)`; `tier from size M` or `default` when the body has no `Tier:` line), the tier distribution of the open items in the report, and the loop's `--model` per PBI (`references/loop.md`). The loop maps the tier to the model: `fast` haiku, `standard` sonnet, `strong` opus; `-Model` overrides it for all PBIs.

## Override

`deliver.roles` in `.agents/config.json` (schema `schema/config.schema.json` of the `implementation` skill). A role entry replaces `model` and `effort` of that role; `tiers` (only `implement` and `fix`) replaces single tiers. Unset keys keep the default. `plan` has no default, so it uses the session model until configured.

```json
{
  "deliver": {
    "roles": {
      "review": { "model": "opus", "effort": "high" },
      "implement": { "tiers": { "standard": { "model": "opus", "effort": "medium" } } },
      "gate": { "model": "sonnet" }
    }
  }
}
```

`model` is what the harness accepts per subagent (`sonnet`, `opus`, `haiku`, `fable`), `effort` one of `low`, `medium`, `high`, `xhigh`, `max`.
