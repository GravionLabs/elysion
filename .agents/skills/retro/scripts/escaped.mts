// The escaped findings of a milestone (references/metrics-sources.md, section "Escaped findings"): problems the
// loop review let through that a later check found. Read-only `gh` calls; the text of issues and comments is data.
import { execFileSync } from 'node:child_process';

const LIMIT = '1000';
const WEEK = 7 * 24 * 60 * 60 * 1000;
export const TRUSTED = ['OWNER', 'MEMBER', 'COLLABORATOR'];
// the comment of the loop that records a verdict on a pull request (`deliver/scripts/review.mts`)
const MARK = /^<!-- deliver-review: (approve|changes) /;

type Note = { body?: string; url?: string; authorAssociation?: string };
type Comment = Note & { createdAt: string };
type Review = Note & { state: string };
type Pull = {
  number: number;
  url: string;
  title: string;
  headRefName: string;
  body: string | null;
  mergedAt: string | null;
  milestone: { title: string } | null;
};
type Ticket = {
  number: number;
  url: string;
  title: string;
  body: string | null;
  createdAt: string;
  labels: { name: string }[];
};

export type Milestone = { title: string; issues: number[] };
export type Escaped = {
  source: 'review' | 'follow-up' | 'after-release';
  number: number;
  url: string;
  title: string;
};

export const gh = <T,>(...args: string[]): T =>
  JSON.parse(
    execFileSync('gh', args, {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  ) as T;

export const clean = (text: string): string =>
  text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();

/** The milestone `<name>`, or `<name> (x.y.z)` after its release, with the numbers of its issues. */
export function findMilestone(name: string): Milestone | undefined {
  const pages = gh<{ title: string }[][]>(
    'api',
    '--paginate',
    '--slurp',
    'repos/{owner}/{repo}/milestones?state=all&per_page=100',
  );
  const title = pages
    .flat()
    .find((m) => m.title === name || m.title.startsWith(`${name} (`))?.title;
  if (!title) return undefined;
  const issues = gh<{ number: number }[]>(
    'issue',
    'list',
    '--milestone',
    title,
    '--state',
    'all',
    '--limit',
    LIMIT,
    '--json',
    'number',
  );
  return { title, issues: issues.map((i) => i.number).sort((a, b) => a - b) };
}

/** A review comment of any session that asks for changes: its review heading says so, or its verdict JSON. */
const asksChanges = (body: string): boolean =>
  /^\s*#{1,6}\s*review\b[^\n]*\bchanges\b/i.test(body) || /"verdict"\s*:\s*"changes"/.test(body);

/**
 * The changes requested on a pull request by others than the loop, and the number of `changes` marks of the loop.
 * `deliver-review` never uses `gh pr review`; its one comment of a round is the last one before the mark of the
 * round, so every `changes` mark takes that comment out.
 */
function reviews(pull: Pull) {
  const view = gh<{ comments: Comment[]; reviews: Review[] }>(
    'pr',
    'view',
    String(pull.number),
    '--json',
    'comments,reviews',
  );
  const trusted = (note: Note) => TRUSTED.includes(note.authorAssociation ?? '');
  let open: Comment[] = [];
  const others: Comment[] = [];
  let marks = 0;
  let marked = false;
  for (const comment of [...view.comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const body = comment.body ?? '';
    const mark = MARK.exec(body);
    if (mark && trusted(comment)) {
      marked = true;
      if (mark[1] === 'changes') {
        marks++;
        open.pop();
      }
      others.push(...open);
      open = [];
    } else if (!mark && asksChanges(body)) open.push(comment);
  }
  const urls = [
    ...[...others, ...open].filter(trusted).map((c) => c.url ?? pull.url),
    ...view.reviews
      .filter((r) => r.state === 'CHANGES_REQUESTED' && trusted(r))
      .map(() => pull.url),
  ];
  return { urls, marks, marked };
}

/**
 * The issues and pull requests of this repository a body names (`#12`, `owner/repo#12`, a URL). Lines that name a
 * parent or a dependency are planning, not a finding.
 */
function references(body: string, repo: string): number[] {
  const text = body
    .split('\n')
    .filter((line) => !/^[\s>*_-]*(parent\b|blocked[ -]by\b|depends on\b|blocks\b)/i.test(line))
    .join('\n');
  const slug = repo.replace(/[.]/g, '\\.');
  const found = text.matchAll(
    new RegExp(
      `(?:github\\.com/${slug}/(?:issues|pull)/|(?<![\\w./-])(?:${slug})?#)(\\d+)(?!\\w)`,
      'gi',
    ),
  );
  return [...found].map((match) => Number(match[1]));
}

const isTicket = (ticket: Ticket, kinds: string[]): boolean =>
  kinds.some(
    (kind) =>
      ticket.title.toLowerCase().startsWith(`[${kind}]`) ||
      ticket.labels.some((label) => label.name.toLowerCase() === kind),
  );

/** The release of the milestone title `<M> (x.y.z)`: its version and publication time. */
function release(title: string) {
  const version = /\((v?\d+\.\d+\.\d+[^)\s]*)\)\s*$/.exec(title)?.[1]?.replace(/^v/, '');
  if (!version) return undefined;
  const found = gh<{ tagName: string; publishedAt: string }[]>(
    'release',
    'list',
    '--limit',
    LIMIT,
    '--json',
    'tagName,publishedAt',
  ).find((r) => r.tagName.replace(/^v/, '') === version);
  return found && { version, at: Date.parse(found.publishedAt) };
}

/**
 * The row `loop review: <x> changes requested, <y> escaped`. `rounds` holds the `changes` rounds of the issues the
 * run folders measured; the other issues are counted by the marks of the loop on their pull requests.
 */
export function loopReview(
  milestone: Milestone,
  rounds: Map<number, number>,
  runPulls: Map<number, string>,
) {
  const members = new Set(milestone.issues);
  const issuesOf = (pull: Pull): number[] =>
    milestone.issues.filter(
      (nr) =>
        runPulls.get(nr) === pull.url ||
        new RegExp(`^[a-z]+/${nr}-`).test(pull.headRefName) ||
        new RegExp(`\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s*:?\\s+#${nr}(?!\\d)`, 'i').test(
          pull.body ?? '',
        ),
    );
  const pulls = gh<Pull[]>(
    'pr',
    'list',
    '--state',
    'all',
    '--limit',
    LIMIT,
    '--json',
    'number,url,title,headRefName,body,mergedAt,milestone',
  )
    .filter((p) => p.milestone?.title === milestone.title || issuesOf(p).length > 0)
    .sort((a, b) => a.number - b.number);

  const items: Escaped[] = [];
  const marked = new Map<number, number>();
  for (const pull of pulls) {
    const seen = reviews(pull);
    for (const url of seen.urls)
      items.push({ source: 'review', number: pull.number, url, title: clean(pull.title) });
    if (!seen.marked) continue;
    for (const nr of issuesOf(pull)) marked.set(nr, (marked.get(nr) ?? 0) + seen.marks);
  }

  const named = new Set([...members, ...pulls.map((p) => p.number)]);
  const merges = pulls.flatMap((p) => (p.mergedAt ? [Date.parse(p.mergedAt)] : []));
  const firstMerge = merges.length ? Math.min(...merges) : undefined;
  const released = release(milestone.title);
  if (firstMerge !== undefined || released) {
    const tickets = gh<Ticket[]>(
      'issue',
      'list',
      '--state',
      'all',
      '--limit',
      LIMIT,
      '--json',
      'number,url,title,body,createdAt,labels',
    ).sort((a, b) => a.number - b.number);
    const name = milestone.title.split(' (')[0] as string;
    for (const ticket of tickets) {
      const created = Date.parse(ticket.createdAt);
      const body = ticket.body ?? '';
      const repo = /github\.com\/([^/]+\/[^/]+)\/issues\//.exec(ticket.url)?.[1] ?? '';
      const names = references(body, repo).some((nr) => nr !== ticket.number && named.has(nr));
      const namesRelease = (version: string) =>
        [version, name].some((word) =>
          new RegExp(`(?<![\\w.])v?${word.replace(/[.+]/g, '\\$&')}(?!\\w|\\.\\d)`, 'i').test(body),
        );
      const source =
        released &&
        isTicket(ticket, ['bug']) &&
        created >= released.at &&
        created <= released.at + WEEK &&
        (names || namesRelease(released.version))
          ? 'after-release'
          : firstMerge !== undefined &&
              created > firstMerge &&
              isTicket(ticket, ['pbi', 'bug']) &&
              names
            ? 'follow-up'
            : undefined;
      if (source)
        items.push({ source, number: ticket.number, url: ticket.url, title: clean(ticket.title) });
    }
  }

  const counts = milestone.issues.flatMap((nr) => rounds.get(nr) ?? marked.get(nr) ?? []);
  return {
    changesRequested: counts.length ? counts.reduce((a, b) => a + b, 0) : null,
    escaped: items.length,
    items,
  };
}
