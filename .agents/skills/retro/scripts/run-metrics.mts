// Turns run folders of the deliver loop (`<git-common-dir>/deliver/<run>/`) into the metrics JSON of `retro`.
//   node run-metrics.mts                      the newest run folder
//   node run-metrics.mts --run <path> …       these run folders (repeatable)
//   node run-metrics.mts --issues 12,15       every run folder that holds one of these issues
//   node run-metrics.mts --milestone M016     the run folders of its issues plus its escaped findings (`gh`)
//   --root <dir>                              the folder of the run folders (default: <git-common-dir>/deliver)
// The files hold text of agents: it is data, validated and stripped of control characters.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { findMilestone, loopReview, type Milestone } from './escaped.mts';

type Session = { costUsd?: unknown; peakContext?: unknown; role?: unknown };
type Row = {
  issue: number;
  title?: unknown;
  outcome: string;
  reason?: unknown;
  risk?: unknown;
  pr?: unknown;
  minutes?: unknown;
  reviews?: { round?: unknown; verdict?: unknown }[];
  sessions: Session[];
};
type Run = { run: string; path: string; status: string | null; rows: Map<number, Row> };
type Finding = {
  issue: number;
  run: string;
  round: number;
  pr: string | null;
  file: string;
  summary: string;
};

const fail = (message: string): never => {
  console.error(`run-metrics: ${message}`);
  process.exit(1);
};

const options = () => {
  try {
    return parseArgs({
      options: {
        run: { type: 'string', multiple: true },
        issues: { type: 'string' },
        root: { type: 'string' },
        milestone: { type: 'string' },
      },
    }).values;
  } catch (error) {
    return fail((error as Error).message.split('\n')[0] as string);
  }
};

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const clean = (value: unknown): string | null =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim() : null;

/**
 * The run of a folder, `undefined` without a `results.jsonl`. Later lines of an issue in the same run (merged or
 * closed by a person after a hand-over) set its outcome and reason; sessions and minutes add up.
 */
function readRun(folder: string): Run | undefined {
  const file = path.join(folder, 'results.jsonl');
  if (!existsSync(file)) return undefined;
  const run: Run = { run: path.basename(folder), path: folder, status: null, rows: new Map() };
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      // empty, or cut off by a run that died
      continue;
    }
    if (!object(value)) continue;
    if (value.run === 'finished') run.status = clean(value.status);
    const { issue, outcome } = value;
    if (!Number.isInteger(issue) || typeof outcome !== 'string') continue;
    const row = {
      ...value,
      sessions: Array.isArray(value.sessions) ? value.sessions.filter(object) : [],
      reviews: Array.isArray(value.reviews) ? value.reviews.filter(object) : undefined,
    } as Row;
    const before = run.rows.get(row.issue);
    run.rows.set(
      row.issue,
      before
        ? {
            ...row,
            title: row.title ?? before.title,
            risk: row.risk ?? before.risk,
            pr: row.pr ?? before.pr,
            minutes: Number(before.minutes ?? 0) + Number(row.minutes ?? 0),
            reviews: row.reviews ?? before.reviews,
            sessions: [...before.sessions, ...row.sessions],
          }
        : row,
    );
  }
  return run;
}

/** A figure only when every session carries it (a harness without a stream, or a killed session, writes 0). */
function figure(sessions: Session[], key: 'costUsd' | 'peakContext', how: 'sum' | 'max') {
  const values = sessions.map((s) => s[key]);
  if (!values.length || !values.every((v): v is number => typeof v === 'number' && v > 0))
    return null;
  return how === 'max' ? Math.max(...values) : Number(values.reduce((a, b) => a + b, 0).toFixed(6));
}

function metrics(row: Row, run: string, earlierRuns: string[]) {
  const role = (sessions: Session[]) => ({
    sessions: sessions.length,
    costUsd: figure(sessions, 'costUsd', 'sum'),
    peakContext: figure(sessions, 'peakContext', 'max'),
  });
  // a line without a session and a review (merged by someone else) measured no round
  const measured = row.reviews && (row.reviews.length > 0 || row.sessions.length > 0);
  return {
    issue: row.issue,
    title: clean(row.title),
    run,
    earlierRuns,
    outcome: clean(row.outcome),
    reason: clean(row.reason),
    risk: clean(row.risk),
    pr: clean(row.pr),
    minutes: row.sessions.length && typeof row.minutes === 'number' ? row.minutes : null,
    costUsd: figure(row.sessions, 'costUsd', 'sum'),
    roles: {
      implement: role(row.sessions.filter((s) => s.role !== 'review')),
      review: role(row.sessions.filter((s) => s.role === 'review')),
    },
    reviewRounds: measured ? row.reviews!.length : null,
    fixRounds: measured ? row.reviews!.filter((r) => r.verdict === 'changes').length : null,
  };
}

/** The findings of `<nr>.review-<round>-<try>.json`: the last try of every round. */
function findings(run: Run, issues: Set<number>): Finding[] {
  const last = new Map<string, { issue: number; round: number; tries: number; name: string }>();
  for (const name of readdirSync(run.path)) {
    const match = /^(\d+)\.review-(\d+)-(\d+)\.json$/.exec(name);
    if (!match) continue;
    const [issue, round, tries] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const key = `${issue}-${round}`;
    if (issues.has(issue) && tries > (last.get(key)?.tries ?? 0))
      last.set(key, { issue, round, tries, name });
  }
  return [...last.values()]
    .sort((a, b) => a.issue - b.issue || a.round - b.round)
    .flatMap(({ issue, round, name }) => {
      let verdict: unknown;
      try {
        verdict = JSON.parse(readFileSync(path.join(run.path, name), 'utf8'));
      } catch {
        return [];
      }
      if (!object(verdict) || !Array.isArray(verdict.findings)) return [];
      const pr = clean(run.rows.get(issue)?.pr);
      return verdict.findings.filter(object).flatMap((f) => {
        const file = clean(f.file);
        const summary = clean(f.summary);
        return file && summary ? [{ issue, run: run.run, round, pr, file, summary }] : [];
      });
    });
}

/** The same file and summary in the pull requests of two or more issues. */
function repeated(all: Finding[]) {
  const groups = new Map<string, Finding[]>();
  for (const finding of all) {
    const key = JSON.stringify([finding.file, finding.summary]);
    groups.set(key, [...(groups.get(key) ?? []), finding]);
  }
  return [...groups.values()].flatMap((group) => {
    // one pull request counts once, also when two runs worked on it
    const pulls = new Set(group.map((f) => f.pr ?? `#${f.issue}`));
    const { file, summary } = group[0] as Finding;
    const issues = [...new Set(group.map((f) => f.issue))];
    return pulls.size > 1 ? [{ file, summary, issues, pulls: [...pulls] }] : [];
  });
}

function defaultRoot(): string {
  try {
    const common = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
    return path.join(common, 'deliver');
  } catch {
    return fail('not in a git repository: pass --root or --run');
  }
}

const opt = options();
if (opt.run && opt.root) fail('--root has no effect with --run');
if (opt.milestone !== undefined && opt.issues !== undefined)
  fail('--milestone and --issues exclude each other');

/** A `gh` call that failed ends the script with its first line: no figure is guessed. */
function fromGh<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    const { stderr, message } = error as Error & { stderr?: string };
    return fail(`gh failed: ${(stderr || message).trim().split('\n')[0]}`);
  }
}

let milestone: Milestone | undefined;
if (opt.milestone !== undefined) {
  const name = opt.milestone;
  milestone = fromGh(() => findMilestone(name)) ?? fail(`no milestone "${name}"`);
}
const wanted =
  milestone?.issues ?? opt.issues?.split(',').map((nr) => Number(nr.trim().replace(/^#/, '')));
if (wanted?.some((nr) => !Number.isInteger(nr) || nr <= 0))
  fail('--issues takes issue numbers: --issues 12,15');

const runs: Run[] = [];
const missing: string[] = [];
if (opt.run) {
  for (const folder of opt.run.map((p) => path.resolve(p))) {
    const run = readRun(folder);
    if (run) runs.push(run);
    else missing.push(folder);
  }
} else {
  const root = path.resolve(opt.root ?? defaultRoot());
  const names =
    existsSync(root) && statSync(root).isDirectory() ? readdirSync(root).sort().reverse() : [];
  for (const name of names) {
    const run = readRun(path.join(root, name));
    if (!run || !run.rows.size) continue;
    if (wanted && !wanted.some((nr) => run.rows.has(nr))) continue;
    runs.push(run);
    if (!wanted) break;
  }
  if (!runs.length) missing.push(root);
}
// the run ids start with the time: the order of the names is the order of the runs
runs.sort((a, b) => a.run.localeCompare(b.run));

const latest = new Map<number, { row: Row; run: string; earlier: string[] }>();
for (const run of runs) {
  for (const [nr, row] of run.rows) {
    if (wanted && !wanted.includes(nr)) continue;
    const before = latest.get(nr);
    latest.set(nr, {
      row,
      run: run.run,
      earlier: before ? [...before.earlier, before.run] : [],
    });
  }
}
const issues = [...latest.values()]
  .map(({ row, run, earlier }) => metrics(row, run, earlier))
  .sort((a, b) => a.issue - b.issue);
const all = runs.flatMap((run) => findings(run, new Set(latest.keys())));
const review =
  milestone &&
  fromGh(() =>
    loopReview(
      milestone,
      new Map(
        issues.flatMap((i) =>
          i.fixRounds === null ? [] : [[i.issue, i.fixRounds] as [number, number]],
        ),
      ),
      new Map(issues.flatMap((i) => (i.pr ? [[i.issue, i.pr] as [number, string]] : []))),
    ),
  );

console.log(
  JSON.stringify(
    {
      runs: runs.map(({ run, path: folder, status }) => ({ run, path: folder, status })),
      missing,
      // asked for, but in no run folder: today's sources measure them
      uncovered: (wanted ?? []).filter((nr) => !latest.has(nr)),
      issues,
      escalations: issues
        .filter((i) => i.outcome === 'aside' || i.outcome === 'handover')
        .map(({ issue, outcome, reason, pr, run }) => ({ issue, outcome, reason, pr, run })),
      findings: all,
      repeated: repeated(all),
      ...(milestone ? { milestone: milestone.title, loopReview: review } : {}),
    },
    null,
    2,
  ),
);
