// Where run files live and which may go (GravionLabs/agent-events, bindings/jsonl-file.md): one directory
// per user, `origin` of `run.started`, retention per origin repository. The PowerShell twin of this file
// is github-release `scripts/EventDirectory.psm1`; both are tested against the same cases.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type Origin = { repo?: string; branch?: string; worktree?: string; host?: string };

/** `AGENT_EVENTS_DIR`, else the per-user default of the platform; `undefined` when there is none. */
export function eventsDirectory(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string | undefined {
  if (env['AGENT_EVENTS_DIR']) return path.resolve(env['AGENT_EVENTS_DIR']);
  if (platform === 'win32') {
    const local = env['LOCALAPPDATA'];
    return local ? path.join(local, 'agent-events') : undefined;
  }
  const state = env['XDG_STATE_HOME'];
  // a relative XDG_STATE_HOME is ignored, as the XDG specification requires
  if (state && path.posix.isAbsolute(state)) return path.join(state, 'agent-events');
  return home ? path.join(home, '.local', 'state', 'agent-events') : undefined;
}

/** `owner/repo` of a remote URL that names a host; `undefined` for a local path or a `file:` URL. */
export function repoOfUrl(url: string): string | undefined {
  let found: string | undefined;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\/[^/]+\/(.*)$/i.exec(url);
  if (scheme) {
    if (scheme[1]!.toLowerCase() !== 'file') found = scheme[2];
  } else {
    // scp form `[user@]host:path`; one letter before the colon is a Windows drive
    found = /^(?:[^/\\:]+@)?[^/\\:@]{2,}:(?!\/\/)(.*)$/.exec(url)?.[1];
  }
  return found?.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '') || undefined;
}

function git(cwd: string, ...args: string[]): string | undefined {
  try {
    const out = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.replace(/\r?\n$/, '') || undefined;
  } catch {
    return undefined;
  }
}

const commonDirectory = (cwd: string): string | undefined => {
  const dir = git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  return dir && path.resolve(dir);
};

/** The `origin` of `run.started` for a writer in `cwd`; a field that does not exist is left out. */
export function runOrigin(cwd: string = process.cwd()): Origin {
  const origin: Origin = {};
  const common = commonDirectory(cwd);
  if (common) {
    const url = git(cwd, 'remote', 'get-url', 'origin');
    origin.repo =
      (url && repoOfUrl(url)) || (path.basename(common) === '.git' ? path.dirname(common) : common);
  }
  const branch = git(cwd, 'symbolic-ref', '--quiet', '--short', 'HEAD');
  if (branch) origin.branch = branch;
  const worktree = git(cwd, 'rev-parse', '--show-toplevel');
  if (worktree) origin.worktree = path.resolve(worktree);
  const host = os.hostname();
  if (host) origin.host = host;
  return origin;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const KEEP = 100;
const RUN_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.jsonl$/;

type Started = { origin?: Origin; host?: Record<string, unknown> };
type RunFile = { file: string; age: number; started: Started | undefined; done: boolean };

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readRun(file: string, now: number): RunFile {
  const age = now - statSync(file).mtimeMs;
  let started: (Started & { type?: unknown }) | undefined;
  let finished = false;
  // the last element is empty or an incomplete line
  for (const line of readFileSync(file, 'utf8').split('\n').slice(0, -1)) {
    try {
      const event = JSON.parse(line) as Started & { type?: unknown };
      if (event.type === 'run.started') started ??= event;
      if (event.type === 'run.finished') finished = true;
    } catch {
      // a line that is not JSON is skipped
    }
  }
  const pid = Number(started?.host?.['jsonl-file.pid']);
  const here = !started?.origin?.host || started.origin.host === os.hostname();
  const dead = here && Number.isInteger(pid) && pid > 0 && !alive(pid);
  return { file, age, started, done: finished || dead || age > HOUR };
}

/** The run files a writer of `repo` MAY delete: its own and those without `origin`, never a running one. */
export function expiredRuns(dir: string, repo: string | undefined, now = Date.now()): string[] {
  const runs: RunFile[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && RUN_FILE.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    // no directory: nothing to delete
  }
  for (const name of names) {
    try {
      runs.push(readRun(path.join(dir, name), now));
    } catch {
      // gone or unreadable: it stays
    }
  }
  const pick = (group: RunFile[], days: number, excess: number) =>
    group
      .filter((run) => run.done)
      .sort((a, b) => b.age - a.age) // oldest first
      .filter((run, i) => run.age > days * DAY || i < excess);
  const own = runs.filter((run) => run.started?.origin && run.started.origin.repo === repo);
  const old = runs.filter((run) => !run.started?.origin);
  const ownDone = own.filter((run) => run.done).length;
  return [...pick(own, 30, ownDone - KEEP), ...pick(old, 7, old.length - KEEP)].map(
    (run) => run.file,
  );
}

const real = (dir: string) => {
  try {
    return realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
};

/** Deletes the expired runs of `dir`; nothing in the legacy directory of the repository of `cwd`. */
export function pruneRuns(dir: string, repo: string | undefined, cwd = process.cwd()): void {
  const common = commonDirectory(cwd);
  if (common && real(dir) === real(path.join(common, '.agents', 'events'))) return;
  for (const file of expiredRuns(dir, repo)) {
    try {
      rmSync(file);
    } catch {
      // retention must not stop a delivery
    }
  }
}
