// The model and tier of each session of the loop: the flag (or the old `deliver.review.model`), else the
// resolver (resolve-model.mts) with the role of the session and the `Tier:` line of the issue.
import {
  type ConfigLayer,
  type HarnessName,
  type Tier,
  TIERS,
  resolveModel,
} from './resolve-model.mts';

/** `note`: a line for the log. */
export type Pick = { model: string; tier: Tier; note?: string };

/** The first `Tier: <tier> — <reason>` line of an issue body; `tier` is unset when it names none of the tiers. */
export function issueTier(body: string): { tier?: Tier; named?: string } {
  const line = /^Tier:[ \t]*([A-Za-z0-9_-]*)/m.exec(body);
  if (!line) return {};
  const named = line[1] as string;
  return { named, tier: TIERS.find((tier) => tier === named.toLowerCase()) };
}

// the same family counts as the same model: `claude-opus-…` and `opus`
const family = (model: string) => /fable|opus|sonnet|haiku/i.exec(model)?.[0].toLowerCase();
const sameModel = (a: string, b: string) =>
  a === b || (family(a) !== undefined && family(a) === family(b));

/** Throws an Error (resolveModel) for a wrong `models` setting, at once and not at the first session. */
export function sessionModels(input: {
  layers: ConfigLayer[];
  harness: HarnessName;
  reviewHarness: HarnessName;
  /** `--model`: wins for every implementer session. */
  model?: string;
  /** `--review-model`, `deliver.review.model`. */
  reviewModel?: string;
}) {
  const { layers, harness, reviewHarness } = input;
  const { warnings } = resolveModel({ role: 'implement', harness, layers });

  function implement(body: string): Pick {
    const { tier, named } = issueTier(body);
    const resolved = resolveModel({ role: 'implement', issueTier: tier, harness, layers });
    if (input.model !== undefined) return { model: input.model, tier: resolved.tier };
    const note = tier
      ? undefined
      : `${named === undefined ? 'no Tier: line' : `unknown tier "${named}"`} in the issue: implements with tier ${resolved.tier}`;
    return { model: resolved.model, tier: resolved.tier, note };
  }

  /** The review of an issue: never the implementer's model, as long as a stronger tier has another one. */
  function review(body: string): Pick {
    const base = {
      role: 'review',
      issueTier: issueTier(body).tier,
      harness: reviewHarness,
      layers,
    };
    let resolved = resolveModel(base);
    if (input.reviewModel !== undefined) return { model: input.reviewModel, tier: resolved.tier };
    const implementer = implement(body).model;
    for (const tier of TIERS.slice(TIERS.indexOf(resolved.tier) + 1)) {
      if (!sameModel(resolved.model, implementer)) break;
      resolved = resolveModel({ ...base, tier });
    }
    const note = sameModel(resolved.model, implementer)
      ? `review runs the implementer's model (${resolved.model}): no stronger tier than ${resolved.tier} has another one`
      : undefined;
    return { model: resolved.model, tier: resolved.tier, note };
  }

  const retro = resolveModel({ role: 'retro', harness: reviewHarness, layers });
  return { implement, review, retro: { model: retro.model, tier: retro.tier }, warnings };
}
