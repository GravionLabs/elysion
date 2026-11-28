// `retro file <comment url>`: reads the ticked drafts of a retro comment and notes what was filed.
// Usage: node scripts/file-drafts.mts list <comment url> [--lessons <lessons skill dir>]
//        node scripts/file-drafts.mts mark <comment url> --item <key> --filed "<#nr | PR #nr>"
// `list` prints the ticked items without a `filed:` note as JSON, creates the label `retro` where a PBI needs it and
// checks the lesson drafts with Get-Lessons.ps1 -Check. `mark` appends the note to one item of the comment.
// The only writes are that label and that note; issues and pull requests are created by the skill.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

const URL_FORM =
  /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:issues|pull)\/(\d+)#issuecomment-(\d+)$/;
const ITEM = /^- \[([ xX])\] (PBI|Lesson): (.*)$/;
const FILED = /\sfiled: (?:PR )?(?:[\w.-]+\/[\w.-]+)?#\d+\s*$/;
const TRUSTED = ['OWNER', 'MEMBER', 'COLLABORATOR'];

type Item = {
  key: string;
  line: number;
  ticked: boolean;
  filed: boolean;
  kind: 'PBI' | 'Lesson';
  title: string;
  draft: string;
};
type Invalid = { kind: string; title: string; reason: string };
type Lesson = { item: Item; repo: string; id: string; content: string };

const gh = (...args: string[]): string =>
  execFileSync('gh', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
function api<T>(route: string): T {
  return JSON.parse(gh('api', route)) as T;
}

function readComment(url: string) {
  const match = URL_FORM.exec(url);
  if (!match) throw new Error('give the URL of a comment: .../issues/<nr>#issuecomment-<id>');
  const [, repo, number, id] = match as unknown as [string, string, string, string];
  const comment = api<{
    body: string;
    issue_url: string;
    author_association: string;
    user: { type: string };
  }>(`repos/${repo}/issues/comments/${id}`);
  if (!comment.issue_url.endsWith(`/issues/${number}`))
    throw new Error(`the comment is not on #${number}`);
  if (!/^<!-- retro: [^\r\n]+? -->/.test(comment.body))
    throw new Error('not a retro comment: the first line is no `<!-- retro: … -->` marker');
  // anyone can write the marker
  if (!TRUSTED.includes(comment.author_association) && comment.user.type !== 'Bot')
    throw new Error('the author of the comment has no write access to the repository');
  return { repo, number: Number(number), id, body: comment.body };
}

/** The checklist items below `## Drafts`; `line` indexes `body.split(/(\r?\n)/)`. */
function parseItems(body: string): Item[] {
  const parts = body.split(/(\r?\n)/);
  const items: (Item & { lines: string[] })[] = [];
  const seen = new Map<string, number>();
  let drafts = false;
  for (let i = 0; i < parts.length; i += 2) {
    const line = parts[i] as string;
    if (/^## Drafts\s*$/.test(line)) drafts = true;
    if (!drafts) continue;
    const match = ITEM.exec(line);
    if (!match) {
      items.at(-1)?.lines.push(line);
      continue;
    }
    const kind = match[2] as Item['kind'];
    const filed = FILED.test(match[3] as string);
    const title = (match[3] as string).replace(FILED, '').trim();
    const hash = createHash('sha256').update(`${kind}: ${title}`).digest('hex').slice(0, 10);
    const n = (seen.get(hash) ?? 0) + 1;
    seen.set(hash, n);
    items.push({
      key: n > 1 ? `${hash}-${n}` : hash,
      line: i,
      ticked: match[1] !== ' ',
      filed,
      kind,
      title,
      draft: '',
      lines: [],
    });
  }
  return items.map(({ lines, ...item }) => ({
    ...item,
    draft: lines
      .map((l) => l.replace(/^ {1,2}/, ''))
      .join('\n')
      .replace(/^\s*<details>\s*(<summary>.*<\/summary>)?/, '')
      .replace(/<\/details>\s*$/, '')
      .trim(),
  }));
}

/** The repository a draft names in a `Repository:` line before any fence, else the one of the comment. */
function repoOf(draft: string, fallback: string): string {
  const head = draft.split(/^(?:`{3,}|~{3,})/m)[0] as string;
  return /^Repository: `?([\w.-]+\/[\w.-]+)`?\s*$/m.exec(head)?.[1] ?? fallback;
}

/** The lesson file of a draft with `status: approved` (the tick is the approval), or why it cannot be filed. */
function lessonOf(draft: string): { id: string; content: string } | string {
  const block = /^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n\1\s*$/m.exec(draft)?.[2];
  const front = block && /^---\n([\s\S]*?)\n---[ \t]*\n/.exec(block)?.[0];
  if (!block || !front) return 'no fenced lesson file with frontmatter';
  const id = /^id:[ \t]*([a-z0-9]+(?:-[a-z0-9]+)*)[ \t]*$/m.exec(front)?.[1];
  if (!id) return 'missing or not kebab-case id';
  const status = /^status:[ \t]*proposed[ \t]*$/gm;
  if (front.match(status)?.length !== 1 || front.match(/^status:/gm)?.length !== 1)
    return 'not a draft with one `status: proposed` (a retire proposal: references/lessons.md)';
  return {
    id,
    content: `${front.replace(status, 'status: approved')}${block.slice(front.length)}\n`,
  };
}

/** `Get-Lessons.ps1 -Check` over the drafts of one repository: lesson index to its errors. */
function check(lessons: Lesson[], script: string): Map<number, string[]> {
  const dir = mkdtempSync(path.join(tmpdir(), 'retro-lessons-'));
  try {
    const folder = path.join(dir, '.agents/lessons');
    mkdirSync(folder, { recursive: true });
    const name = (i: number) => `draft-${String(i).padStart(3, '0')}.md`;
    lessons.forEach((l, i) => writeFileSync(path.join(folder, name(i)), l.content));
    const ran = spawnSync('pwsh', ['-NoProfile', '-File', script, '-Check'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(dir) },
    });
    const errors = new Map<number, string[]>();
    for (const [, index, reason] of (ran.stdout ?? '').matchAll(/draft-(\d+)\.md: (.*)/g))
      errors.set(Number(index), [...(errors.get(Number(index)) ?? []), (reason as string).trim()]);
    if (ran.status !== 0 && !errors.size)
      throw new Error(`Get-Lessons.ps1 -Check failed: ${ran.error?.message ?? ran.stderr}`);
    return errors;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The installed `lessons` skill: next to this one, or in the `shared` group of the skills repository. */
function checkScript(given: string | undefined): string {
  const skill = path.resolve(import.meta.dirname, '..');
  const dirs = given ? [given] : [`${skill}/../lessons`, `${skill}/../../shared/lessons`];
  const found = dirs
    .map((d) => path.resolve(d, 'scripts/Get-Lessons.ps1'))
    .find((f) => existsSync(f));
  if (!found) throw new Error('the `lessons` skill is not installed: pass --lessons <dir>');
  return found;
}

function ensureLabel(repo: string): void {
  try {
    gh('api', `repos/${repo}/labels/retro`);
  } catch (error) {
    if (!/HTTP 404/.test((error as { stderr?: string }).stderr ?? '')) throw error;
    gh(
      'api',
      '-X',
      'POST',
      `repos/${repo}/labels`,
      '-f',
      'name=retro',
      '-f',
      'color=5319e7',
      '-f',
      'description=Filed from a retro',
    );
  }
}

function list(url: string, lessonsDir: string | undefined) {
  const comment = readComment(url);
  const all = parseItems(comment.body);
  const open = all.filter((i) => i.ticked && !i.filed);
  const owner = comment.repo.split('/')[0] as string;
  const invalid: Invalid[] = [];
  const pbis: object[] = [];
  const lessons: Lesson[] = [];
  const reject = ({ kind, title }: Item, reason: string) => invalid.push({ kind, title, reason });
  for (const item of open) {
    const repo = repoOf(item.draft, comment.repo);
    if (repo.split('/')[0]?.toLowerCase() !== owner.toLowerCase()) {
      reject(item, `repository ${repo} has another owner than the comment`);
    } else if (item.kind === 'PBI') {
      if (!item.draft) reject(item, 'no draft under the item');
      else pbis.push({ key: item.key, title: item.title, repo, draft: item.draft });
    } else {
      const lesson = lessonOf(item.draft);
      if (typeof lesson === 'string') reject(item, lesson);
      else lessons.push({ item, repo, ...lesson });
    }
  }
  const valid: object[] = [];
  for (const repo of new Set(lessons.map((l) => l.repo))) {
    const group = lessons.filter((l) => l.repo === repo);
    const errors = check(group, checkScript(lessonsDir));
    group.forEach(({ item, id, content }, i) => {
      const found = errors.get(i);
      if (found) reject(item, found.join('; '));
      else valid.push({ key: item.key, title: item.title, repo, id, content });
    });
  }
  for (const repo of new Set(pbis.map((p) => (p as { repo: string }).repo))) ensureLabel(repo);
  let feature: number | null = null;
  if (pbis.length) {
    const target = api<{ title: string; labels: { name: string }[]; pull_request?: object }>(
      `repos/${comment.repo}/issues/${comment.number}`,
    );
    const isFeature =
      target.labels.some((l) => l.name === 'feature') || target.title.startsWith('[Feature]');
    if (!target.pull_request && isFeature) feature = comment.number;
  }
  return {
    repo: comment.repo,
    feature,
    pbis,
    lessons: valid,
    invalid,
    unticked: all.filter((i) => !i.ticked && !i.filed).length,
    filed: all.filter((i) => i.filed).length,
  };
}

function mark(url: string, key: string, filed: string): string {
  if (!FILED.test(` filed: ${filed}`)) throw new Error('--filed is `#<nr>` or `PR #<nr>`');
  const comment = readComment(url);
  const item = parseItems(comment.body).find((i) => i.key === key);
  if (!item) throw new Error(`no item ${key} in the comment: run list again`);
  if (item.filed) throw new Error(`item "${item.title}" already has a filed: note`);
  if (!item.ticked) throw new Error(`item "${item.title}" is not ticked`);
  const parts = comment.body.split(/(\r?\n)/);
  parts[item.line] = `${(parts[item.line] as string).trimEnd()} filed: ${filed}`;
  const dir = mkdtempSync(path.join(tmpdir(), 'retro-'));
  try {
    const file = path.join(dir, 'body.md');
    writeFileSync(file, parts.join(''));
    const route = `repos/${comment.repo}/issues/comments/${comment.id}`;
    gh('api', '-X', 'PATCH', route, '-F', `body=@${file}`, '--jq', '.html_url');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return `${item.kind}: ${item.title} filed: ${filed}`;
}

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { item: { type: 'string' }, filed: { type: 'string' }, lessons: { type: 'string' } },
  });
  const [command, url] = positionals;
  if (command === 'list' && url) console.log(JSON.stringify(list(url, values.lessons), null, 2));
  else if (command === 'mark' && url && values.item && values.filed)
    console.log(mark(url, values.item, values.filed));
  else throw new Error('list <comment url> | mark <comment url> --item <key> --filed <note>');
} catch (error) {
  const { stderr, message } = error as { stderr?: string; message: string };
  console.error(`file-drafts: ${String(stderr || message).trim()}`);
  process.exit(1);
}
