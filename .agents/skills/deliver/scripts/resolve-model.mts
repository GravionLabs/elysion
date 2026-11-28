#!/usr/bin/env node
// Which model for this role: `node resolve-model.mts <role> [--tier <t>] [--harness <h>] [--json]`.
// The key `models` maps roles to tiers and tiers to a model per harness. Per value the flag wins over the
// repository's .agents/config.json, that over ~/.agents/config.json, that over the defaults.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const HARNESS_NAMES = ['claude', 'copilot'] as const;
export const TIERS = ['fast', 'standard', 'strong'] as const;
/** `tier`: the tier of the issue (`--tier`), `standard` without one. */
export const ROLE_TIERS = [...TIERS, 'tier'] as const;

export type HarnessName = (typeof HARNESS_NAMES)[number];
export type Tier = (typeof TIERS)[number];
export type RoleTier = (typeof ROLE_TIERS)[number];

export const DEFAULT_TIERS: Record<HarnessName, Record<Tier, string>> = {
  claude: { fast: 'haiku', standard: 'sonnet', strong: 'opus' },
  copilot: {
    fast: 'claude-haiku-5.5',
    standard: 'claude-sonnet-5.5',
    strong: 'claude-opus-5.5',
  },
};

export const DEFAULT_ROLES = {
  orchestrator: 'strong',
  triage: 'strong',
  planner: 'strong',
  implement: 'tier',
  review: 'strong',
  retro: 'standard',
  release: 'standard',
} satisfies Record<string, RoleTier>;

export type Role = keyof typeof DEFAULT_ROLES;
export const ROLES = Object.keys(DEFAULT_ROLES) as Role[];

// A model name goes into a command line: one plain token, optionally with a suffix like `[1m]`.
const MODEL_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*(\[[A-Za-z0-9]+\])?$/;

export type Source = 'flag' | 'repository' | 'user' | 'default';
/** The content of one config file and where it comes from; `file` names it in messages. */
export type ConfigLayer = { source: 'user' | 'repository'; file: string; config: unknown };

export type Resolved = {
  role: Role;
  harness: HarnessName;
  tier: Tier;
  model: string;
  sources: { harness: Source; tier: Source; model: Source };
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function oneOf<T extends string>(what: string, value: unknown, valid: readonly T[]): T {
  if (valid.includes(value as T)) return value as T;
  throw new Error(`unknown ${what} ${JSON.stringify(value)}: one of ${valid.join(', ')}`);
}

/**
 * Resolves the model of a role. `layers` are the config files, the weaker one first. Throws an Error whose
 * message names the wrong value; unknown keys under `models` are ignored with one warning per file.
 */
export function resolveModel(input: {
  role: string;
  tier?: string;
  /** The tier of the issue: only a role mapped to `tier` takes it, and `tier` (the flag) wins over it. */
  issueTier?: Tier;
  harness?: string;
  layers?: ConfigLayer[];
}): Resolved & { warnings: string[] } {
  const role = oneOf('role', input.role, ROLES);
  const harness = oneOf('harness', input.harness ?? 'claude', HARNESS_NAMES);
  const flagTier = input.tier === undefined ? undefined : oneOf('tier', input.tier, TIERS);

  let roleTier: { value: RoleTier; source: Source } = {
    value: DEFAULT_ROLES[role],
    source: 'default',
  };
  const models = new Map<Tier, { value: string; source: Source }>(
    TIERS.map((tier) => [tier, { value: DEFAULT_TIERS[harness][tier], source: 'default' }]),
  );
  const warnings: string[] = [];

  // every entry is checked, also the ones this call does not use: a bad config fails on the first call
  for (const { source, file, config } of input.layers ?? []) {
    const unknown: string[] = [];
    const section = (value: unknown, name: string, keys: readonly string[]) => {
      if (value === undefined) return [];
      if (!isObject(value)) throw new Error(`${file}: ${name} is an object`);
      return Object.entries(value).filter(([key]) => {
        if (keys.includes(key)) return true;
        unknown.push(`${name}.${key}`);
        return false;
      });
    };
    const root = Object.fromEntries(
      section(isObject(config) ? config.models : undefined, 'models', ['tiers', 'roles']),
    );
    for (const [name, entries] of section(root.tiers, 'models.tiers', HARNESS_NAMES))
      for (const [tier, model] of section(entries, `models.tiers.${name}`, TIERS)) {
        if (typeof model !== 'string' || !MODEL_TOKEN.test(model))
          throw new Error(
            `${file}: models.tiers.${name}.${tier} is no model name (one token of letters, digits and . _ : / -): ${JSON.stringify(model)}`,
          );
        if (name === harness) models.set(tier as Tier, { value: model, source });
      }
    for (const [name, value] of section(root.roles, 'models.roles', ROLES)) {
      const tier = oneOf(`tier in ${file}: models.roles.${name}`, value, ROLE_TIERS);
      if (name === role) roleTier = { value: tier, source };
    }
    if (unknown.length)
      warnings.push(
        `${file}: ${unknown.join(', ')} ignored (models reads tiers.{${HARNESS_NAMES.join(', ')}}.{${TIERS.join(', ')}} and roles.{${ROLES.join(', ')}})`,
      );
  }

  const tier: { value: Tier; source: Source } = flagTier
    ? { value: flagTier, source: 'flag' }
    : roleTier.value === 'tier'
      ? input.issueTier
        ? { value: input.issueTier, source: roleTier.source }
        : { value: 'standard', source: 'default' }
      : { value: roleTier.value, source: roleTier.source };
  const model = models.get(tier.value)!;
  return {
    role,
    harness,
    tier: tier.value,
    model: model.value,
    sources: {
      harness: input.harness === undefined ? 'default' : 'flag',
      tier: tier.source,
      model: model.source,
    },
    warnings,
  };
}

/** `~/.agents/config.json`, then `<root>/.agents/config.json`; a missing file is no layer, invalid JSON throws. */
export function readLayers(root: string, home: string = homedir()): ConfigLayer[] {
  const files = [
    { source: 'user' as const, file: path.join(home, '.agents/config.json') },
    { source: 'repository' as const, file: path.join(root, '.agents/config.json') },
  ];
  return files.flatMap((layer) => {
    let text: string;
    try {
      text = readFileSync(layer.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new Error(`${layer.file}: not readable (${(error as Error).message})`);
    }
    try {
      return [{ ...layer, config: JSON.parse(text) as unknown }];
    } catch {
      throw new Error(`${layer.file}: invalid JSON`);
    }
  });
}

/** The root of the git checkout, else the current directory. */
function projectRoot(): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return process.cwd();
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        tier: { type: 'string' },
        harness: { type: 'string' },
        json: { type: 'boolean', default: false },
      },
    });
    if (positionals.length !== 1) throw new Error(`give exactly one role: ${ROLES.join(', ')}`);
    const { warnings, ...resolved } = resolveModel({
      role: positionals[0]!,
      tier: values.tier,
      harness: values.harness,
      layers: readLayers(projectRoot()),
    });
    for (const warning of warnings) console.error(warning);
    console.log(values.json ? JSON.stringify(resolved) : resolved.model);
  } catch (error) {
    console.error(`resolve-model: ${(error as Error).message.split('\n')[0]}`);
    process.exitCode = 64;
  }
}
