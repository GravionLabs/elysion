// Matches the planned files of every item of a plan against the protected paths of `deliver`.
// Usage: node scripts/check-protected.mts --plan <plan.json> [--root <repository>] [--deliver-dir <dir>] [--fix]
// A hit without the label `interactive`, or one the Technical Notes of the body do not name, is an error (exit 1);
// `--fix` adds both to the plan file. A manifest the Technical Notes declare as `Dependency-only: <path>` is no hit.
// An item without files is a warning. Exit 64: wrong usage or unreadable input.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type * as Rules from '../../deliver/scripts/protected-paths.mts';

type Item = { id: string; body?: string; files?: string[]; labels?: string[] };

const LABEL = 'interactive';
const HEADING = /^##[ \t]+Technical Notes[ \t]*$/im;
const DECLARED = /^[ \t]*(?:[-*][ \t]+)?Dependency-only:(.*)$/i;

function stop(message: string): never {
  console.error(`check-protected: ${message}`);
  process.exit(64);
}

/** Start and end of the text of `## Technical Notes`, nothing when the body has none. */
function notesRange(body: string): [number, number] | undefined {
  const heading = HEADING.exec(body);
  if (!heading) return undefined;
  const start = heading.index + heading[0].length;
  const next = /^##?[ \t]/m.exec(body.slice(start));
  return [start, next ? start + next.index : body.length];
}

const clean = (file: string) =>
  file
    .trim()
    .replace(/^`+|`+$/g, '')
    .replace(/^(\.\/)+/, '');
const words = (line: string) =>
  line
    .split(/[\s,;()`]+/)
    .map((word) => clean(word.replace(/[.:]+$/, '')))
    .filter(Boolean);

/** What the Technical Notes of a body say: the files declared dependency-only and the other words (file names). */
function readNotes(body: string): { declared: Set<string>; named: Set<string> } {
  const declared = new Set<string>();
  const named = new Set<string>();
  const range = notesRange(body);
  for (const line of range ? body.slice(...range).split(/\r?\n/) : []) {
    const match = DECLARED.exec(line);
    for (const word of words(match ? match[1]! : line)) (match ? declared : named).add(word);
  }
  return { declared, named };
}

/** The body with `line` at the end of its Technical Notes; the section is added before the Definition of Done. */
function addNote(body: string, line: string): string {
  const range = notesRange(body);
  const done = /^##[ \t]+Definition of Done/im.exec(body);
  const at = range ? range[1] : (done?.index ?? body.length);
  const head = body.slice(0, at).trimEnd();
  const tail = body.slice(at);
  const section = range ? '' : '## Technical Notes\n\n';
  return `${head}\n${range ? '' : '\n'}${section}${line}\n${tail ? `\n${tail}` : ''}`;
}

const { values } = (() => {
  try {
    return parseArgs({
      options: {
        plan: { type: 'string' },
        root: { type: 'string' },
        'deliver-dir': { type: 'string' },
        fix: { type: 'boolean' },
      },
    });
  } catch (error) {
    return stop((error as Error).message);
  }
})();
if (!values.plan) stop('--plan <plan.json> is required');
const root = path.resolve(values.root ?? '.');

// The rules and the default list belong to the `deliver` skill: next to this skill, else a project or global install.
const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = values['deliver-dir']
  ? [path.resolve(values['deliver-dir'])]
  : [
      path.join(here, '../../deliver'),
      ...[root, homedir()].flatMap((base) =>
        ['.claude/skills/deliver', '.agents/skills/deliver'].map((dir) => path.join(base, dir)),
      ),
    ];
const rulesFile = candidates
  .map((dir) => path.join(dir, 'scripts/protected-paths.mts'))
  .find((file) => existsSync(file));
if (!rulesFile)
  stop('the `deliver` skill (scripts/protected-paths.mts) is not installed or outdated');
const rules: typeof Rules = await import(pathToFileURL(rulesFile).href);

let config: { deliver?: { protectedPaths?: string[] } } = {};
try {
  config = JSON.parse(readFileSync(path.join(root, '.agents/config.json'), 'utf8'));
} catch {
  // no project config: the default list, as the loop does
}
const list = rules.protectedList(config.deliver?.protectedPaths);

let plan: { level?: string; items?: Item[] };
try {
  plan = JSON.parse(readFileSync(values.plan, 'utf8'));
} catch (error) {
  stop(`cannot read ${values.plan}: ${(error as Error).message}`);
}
if (!Array.isArray(plan?.items)) stop(`${values.plan} has no items[]`);

let errors = 0;
let fixed = 0;
// Features have no pull request of their own: only PBIs are delivered.
for (const item of plan.level === 'feature' ? [] : plan.items) {
  const files = (item.files ?? []).map(clean).filter(Boolean);
  if (files.length === 0) {
    console.log(`warning: ${item.id}: no files listed, protected paths not checked`);
    continue;
  }
  const { declared, named } = readNotes(item.body ?? '');
  const hits = rules
    .protectedHits(files, list)
    .filter((file) => !(declared.has(file) && rules.exceptedManifest(file, list)));
  if (hits.length === 0) continue;
  const unlabeled = !item.labels?.includes(LABEL);
  const unnamed = hits.filter((file) => !named.has(file));
  if (!unlabeled && unnamed.length === 0) {
    console.log(`hit: ${item.id}: ${hits.join(', ')} (${LABEL})`);
    continue;
  }
  if (values.fix) {
    if (unlabeled) item.labels = [...(item.labels ?? []), LABEL];
    if (unnamed.length > 0)
      item.body = addNote(
        item.body ?? '',
        `Protected paths (a person merges): ${unnamed.map((file) => `\`${file}\``).join(', ')}`,
      );
    fixed++;
    console.log(`fixed: ${item.id}: ${hits.join(', ')} (${LABEL})`);
    continue;
  }
  errors++;
  if (unlabeled)
    console.log(
      `error: ${item.id}: changes protected paths (${hits.join(', ')}) without the label ${LABEL}`,
    );
  if (unnamed.length > 0)
    console.log(`error: ${item.id}: Technical Notes do not name ${unnamed.join(', ')}`);
}
if (fixed > 0) writeFileSync(values.plan, `${JSON.stringify(plan, null, 2)}\n`);
process.exitCode = errors > 0 ? 1 : 0;
