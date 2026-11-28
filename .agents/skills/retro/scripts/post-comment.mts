// `retro --post`: writes the report as one comment with the marker `<!-- retro: <milestone> -->` on the Feature that
// holds most of the milestone's issues, else on the release pull request; a rerun edits that comment.
// With `--objective` the marker is `<!-- retro: objective -->` and the comment goes on the Objective.
// Usage: node scripts/post-comment.mts --milestone <M> --file <report.md> [--release-pr <nr|url>]
//        node scripts/post-comment.mts --objective <owner>/<repo>#<nr> --file <report.md>
// With DELIVER_RETRO_FILE set (the `deliver` loop) the URL of the comment is written there too.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { findMilestone } from './escaped.mts';
import { parseObjective } from './objective.mts';

/** GitHub refuses a longer comment. */
const MAX_BODY = 65_536;
const COMMENTS = `query($owner: String!, $repo: String!, $number: Int!, $endCursor: String) {
  repository(owner: $owner, name: $repo) {
    issueOrPullRequest(number: $number) {
      ... on Issue { comments(first: 100, after: $endCursor) { ...page } }
      ... on PullRequest { comments(first: 100, after: $endCursor) { ...page } }
    }
  }
}
fragment page on IssueCommentConnection {
  nodes { url body viewerDidAuthor }
  pageInfo { hasNextPage endCursor }
}`;

type Parent = {
  number: number;
  title: string;
  repository_url: string;
  labels: { name: string }[];
};
type Comment = { url: string; body: string; viewerDidAuthor: boolean };
type Page = { data: { repository: { issueOrPullRequest: { comments: { nodes: Comment[] } } } } };

const gh = (...args: string[]): string =>
  execFileSync('gh', args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

/** The Feature of this repository that is the parent of most of the issues (a tie: the lowest number). */
function featureOf(repo: string, issues: number[]): number | undefined {
  const count = new Map<number, number>();
  for (const issue of issues) {
    let parent: Parent;
    try {
      parent = JSON.parse(gh('api', `repos/${repo}/issues/${issue}/parent`)) as Parent;
    } catch (error) {
      // no parent
      if (/HTTP 404/.test((error as { stderr?: string }).stderr ?? '')) continue;
      throw error;
    }
    const feature =
      parent.labels.some((l) => l.name === 'feature') || parent.title.startsWith('[Feature]');
    if (feature && parent.repository_url.endsWith(`/repos/${repo}`))
      count.set(parent.number, (count.get(parent.number) ?? 0) + 1);
  }
  return [...count].sort(([a, x], [b, y]) => y - x || a - b)[0]?.[0];
}

function postMilestone(milestone: string, report: string, releasePr: string | undefined): string {
  // the title of a released milestone is `<M> (x.y.z)`: the marker keeps the name
  const name = milestone.replace(/ \(\d+\.\d+\.\d+\)$/, '');
  if (/[\r\n]|-->/.test(name) || name === 'objective') throw new Error('invalid milestone name');
  const found = findMilestone(name);
  if (!found) throw new Error(`milestone ${name} not found`);
  const repo = gh('repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner');
  const release = /(?:^|\/pull\/)(\d+)$/.exec(releasePr ?? '')?.[1];
  const target = featureOf(repo, found.issues) ?? (release ? Number(release) : undefined);
  if (!target)
    throw new Error(`${name} has no Feature: pass the release pull request with --release-pr`);
  return upsert(repo, target, `<!-- retro: ${name} -->`, report);
}

/** Writes the comment that starts with `marker` on the issue or pull request, or edits the own one. */
function upsert(repo: string, target: number, marker: string, report: string): string {
  const body = `${marker}\n${report.trim()}\n`;
  if (body.length > MAX_BODY)
    throw new Error(`the report has ${body.length} characters, at most ${MAX_BODY}: shorten it`);
  const [owner, repoName] = repo.split('/') as [string, string];
  const pages = JSON.parse(
    gh(
      'api',
      'graphql',
      '--paginate',
      '--slurp',
      '-f',
      `query=${COMMENTS}`,
      '-f',
      `owner=${owner}`,
      '-f',
      `repo=${repoName}`,
      '-F',
      `number=${target}`,
    ),
  ) as Page[];
  // anyone can write the marker: only a comment of this login (a user or an app) is edited
  const own = pages
    .flatMap((page) => page.data.repository.issueOrPullRequest.comments.nodes)
    .find((c) => c.viewerDidAuthor && c.body.startsWith(marker));
  const id = own && /#issuecomment-(\d+)$/.exec(own.url)?.[1];
  const dir = mkdtempSync(path.join(tmpdir(), 'retro-'));
  try {
    const file = path.join(dir, 'body.md');
    writeFileSync(file, body);
    const route = id
      ? ['-X', 'PATCH', `repos/${repo}/issues/comments/${id}`]
      : ['-X', 'POST', `repos/${repo}/issues/${target}/comments`];
    return gh('api', ...route, '-F', `body=@${file}`, '--jq', '.html_url');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

try {
  const { values } = parseArgs({
    options: {
      milestone: { type: 'string' },
      objective: { type: 'string' },
      file: { type: 'string' },
      'release-pr': { type: 'string' },
    },
  });
  if (!values.milestone === !values.objective || !values.file)
    throw new Error('give --milestone <M> or --objective <owner>/<repo>#<nr>, and --file <path>');
  const report = readFileSync(values.file, 'utf8');
  let url: string;
  if (values.objective) {
    const { repo, number } = parseObjective(values.objective);
    url = upsert(repo, number, '<!-- retro: objective -->', report);
  } else url = postMilestone(values.milestone as string, report, values['release-pr']);
  if (process.env.DELIVER_RETRO_FILE)
    writeFileSync(process.env.DELIVER_RETRO_FILE, JSON.stringify({ url }));
  console.log(url);
} catch (error) {
  const { stderr, message } = error as { stderr?: string; message: string };
  console.error(`post-comment: ${String(stderr || message).trim()}`);
  process.exit(1);
}
