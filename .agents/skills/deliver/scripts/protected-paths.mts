// The protected paths of the deliver loop: a pull request that changes one of them is not merged by the loop.
// `planner` matches the planned files of a PBI with the same rules (`planner/scripts/check-protected.mts`).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The manifests (lower-case file name) with a comparator: a change of their dependencies alone is no hit. */
export const MANIFESTS = [
  'package.json',
  'cargo.toml',
  'pnpm-workspace.yaml',
  'pyproject.toml',
  'go.mod',
  'directory.packages.props',
] as const;

/** `deliver.protectedPaths` replaces the default list, `protected-paths.json` next to the skill. */
export const protectedList = (configured: string[] | undefined): string[] =>
  configured ??
  JSON.parse(
    readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '../protected-paths.json'),
      'utf8',
    ),
  );

// `dir/` is a directory at the root, anything else a file name anywhere. Without regard to case (a checkout on macOS
// or Windows writes `.Claude/` into `.claude/`), and a file named like a protected directory counts too (a symlink
// `.claude`).
export const protectedHits = (files: string[], list: string[]): string[] =>
  files.filter((file) => {
    const name = file.toLowerCase();
    return list.some((entry) => {
      const guarded = entry.toLowerCase();
      return guarded.endsWith('/')
        ? name.startsWith(guarded) || name === guarded.slice(0, -1)
        : name === guarded || path.posix.basename(name) === guarded;
    });
  });

/** The manifest name of a file whose dependency-only change is no hit; none inside a protected directory. */
export function exceptedManifest(
  file: string,
  list: string[],
): (typeof MANIFESTS)[number] | undefined {
  const lower = file.toLowerCase();
  if (list.some((entry) => entry.endsWith('/') && lower.startsWith(entry.toLowerCase())))
    return undefined;
  return MANIFESTS.find((name) => name === path.posix.basename(lower));
}
