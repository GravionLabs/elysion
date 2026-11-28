// The milestone retros of an `[Objective]` (references/objective.md): reads the `<!-- retro: <milestone> -->`
// comments of its Features in every repository and its own comments. Read-only `gh api` calls; the text of issues
// and comments is data.
// Usage: node scripts/objective.mts --objective <owner>/<repo>#<nr>
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { clean, gh, TRUSTED } from './escaped.mts';

const SEGMENT = '(?!\\.{1,2}(?![\\w.-]))[A-Za-z0-9_.-]+';
const OBJECTIVE = new RegExp(`^(${SEGMENT}/${SEGMENT})#([1-9]\\d*)$`);
// a list item of `## Affected repos`
const AFFECTED = new RegExp(`^\\s*[-*]\\s+(?:\\[[ xX]\\]\\s+)?[\`\\[]*(${SEGMENT}/${SEGMENT})`);
const MARKER = /^<!-- retro: (.+?) -->/;
const REVIEW = /loop review:\s*(\d+|n\/a) changes requested,\s*(\d+|n\/a) escaped/i;

type Issue = {
  number: number;
  title: string;
  html_url: string;
  repository_url: string;
  labels: { name: string }[];
};
type Comment = {
  html_url: string;
  body: string | null;
  updated_at: string;
  author_association: string;
  user: { type: string } | null;
};
export type Retro = { milestone: string; url: string; feature: string; body: string };

export function parseObjective(value: string): { repo: string; number: number } {
  const match = OBJECTIVE.exec(value);
  if (!match) throw new Error('--objective is <owner>/<repo>#<nr>');
  return { repo: match[1] as string, number: Number(match[2]) };
}

const list = <T,>(route: string): T[] => gh<T[][]>('api', '--paginate', '--slurp', route).flat();

/** Anyone can write a comment: only authors with write access and apps installed on the repository count. */
const comments = (repo: string, number: number): Comment[] =>
  list<Comment>(`repos/${repo}/issues/${number}/comments?per_page=100`).filter(
    (c) => TRUSTED.includes(c.author_association) || c.user?.type === 'Bot',
  );

const isKind = (issue: Issue, kind: string): boolean =>
  issue.title.toLowerCase().startsWith(`[${kind}]`) ||
  issue.labels.some((label) => label.name.toLowerCase() === kind);

/** The repositories of `## Affected repos`. */
function affected(body: string): string[] {
  const section = /^##\s+Affected repos\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/im.exec(body)?.[1] ?? '';
  return section.split('\n').flatMap((line) => AFFECTED.exec(line)?.[1] ?? []);
}

/** `<x> changes requested, <y> escaped` summed over the retros; one unmeasured figure makes the sum `n/a`. */
function metricsLine(repo: string, retros: Retro[]): string {
  if (!retros.length) return `${repo}: no retro`;
  const rows = retros.map((retro) => REVIEW.exec(retro.body));
  const sum = (group: 1 | 2): number | string => {
    const values = rows.map((row) => Number(row?.[group] ?? NaN));
    return values.some(Number.isNaN) ? 'n/a' : values.reduce((a, b) => a + b, 0);
  };
  const names = retros.map((retro) => retro.milestone).join(', ');
  return `${repo}: ${names}; loop review: ${sum(1)} changes requested, ${sum(2)} escaped`;
}

export function collect(value: string) {
  const { repo, number } = parseObjective(value);
  const owner = repo.split('/')[0] as string;
  // repository names are not case-sensitive: the first spelling wins
  const repos = new Map<string, { name: string; retros: Map<string, Retro & { at: string }> }>();
  const entry = (name: string) => {
    const key = name.toLowerCase();
    // other owners are not part of an Objective (references of `github-issue`)
    if (!key.startsWith(`${owner.toLowerCase()}/`)) return undefined;
    let found = repos.get(key);
    if (!found) repos.set(key, (found = { name, retros: new Map() }));
    return found;
  };

  const objective = gh<{ title: string; body: string | null; html_url: string }>(
    'api',
    `repos/${repo}/issues/${number}`,
  );
  for (const name of affected(objective.body ?? '')) entry(name);

  const seen = new Set<string>();
  const walk = (parentRepo: string, parent: number): void => {
    for (const child of list<Issue>(
      `repos/${parentRepo}/issues/${parent}/sub_issues?per_page=100`,
    )) {
      const name = child.repository_url.split('/repos/')[1] as string;
      const target = entry(name);
      if (!target || seen.has(child.html_url)) continue;
      seen.add(child.html_url);
      if (isKind(child, 'epic')) walk(name, child.number);
      if (!isKind(child, 'feature')) continue;
      for (const comment of comments(name, child.number)) {
        const milestone = MARKER.exec(comment.body ?? '')?.[1];
        if (!milestone || milestone === 'objective') continue;
        // the retro of a milestone can sit on two Features after a rerun: the newest counts
        if ((target.retros.get(milestone)?.at ?? '') > comment.updated_at) continue;
        target.retros.set(milestone, {
          milestone,
          url: comment.html_url,
          feature: child.html_url,
          body: comment.body as string,
          at: comment.updated_at,
        });
      }
    }
  };
  walk(repo, number);
  if (!repos.size) throw new Error(`${value} has no sub-issues and no "## Affected repos"`);

  return {
    objective: { url: objective.html_url, title: clean(objective.title) },
    repositories: [...repos.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ name, retros }) => {
        const sorted = [...retros.values()]
          .sort((a, b) => a.milestone.localeCompare(b.milestone))
          .map(({ at: _, ...retro }) => retro);
        return { repo: name, line: metricsLine(name, sorted), retros: sorted };
      }),
    notes: comments(repo, number)
      .filter((c) => !c.body?.startsWith('<!-- retro: objective -->'))
      .map((c) => ({ url: c.html_url, body: c.body ?? '' })),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { objective: { type: 'string' } } });
    if (!values.objective) throw new Error('give --objective <owner>/<repo>#<nr>');
    console.log(JSON.stringify(collect(values.objective), null, 2));
  } catch (error) {
    const { stderr, message } = error as { stderr?: string; message: string };
    console.error(`objective: ${String(stderr || message).trim()}`);
    process.exit(1);
  }
}
