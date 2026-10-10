import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** `docker` with arguments; the project's repository root is the working directory so `compose` finds its files. */
export async function docker(
  args: string[],
  cwd = process.env.COMPOSE_DIR ?? process.cwd(),
): Promise<string> {
  const { stdout } = await run('docker', args, { cwd, maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

/** The containers of one compose service, by name. */
export async function containersOf(service: string): Promise<string[]> {
  const out = await docker([
    'ps',
    '--filter',
    `label=com.docker.compose.service=${service}`,
    '--filter',
    `label=com.docker.compose.project=${process.env.COMPOSE_PROJECT ?? 'elysion'}`,
    '--format',
    '{{.Names}}',
  ]);
  return out.split('\n').filter(Boolean).sort();
}

export interface ContainerUse {
  name: string;
  cpuPercent: number;
  memoryMiB: number;
}

/** CPU and memory of every container of the stack at this moment. */
export async function containerUse(names: string[]): Promise<ContainerUse[]> {
  if (names.length === 0) return [];
  const out = await docker(['stats', '--no-stream', '--format', '{{json .}}', ...names]);
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const row = JSON.parse(line) as { Name: string; CPUPerc: string; MemUsage: string };
      return {
        name: row.Name,
        cpuPercent: Number.parseFloat(row.CPUPerc),
        memoryMiB: toMiB(row.MemUsage.split('/')[0]!.trim()),
      };
    });
}

function toMiB(text: string): number {
  const value = Number.parseFloat(text);
  if (text.endsWith('GiB')) return value * 1024;
  if (text.endsWith('KiB')) return value / 1024;
  if (text.endsWith('MiB')) return value;
  return value / (1024 * 1024);
}

/** The `/metrics` text of a realtime container, read from inside it (the port is not published). */
export async function realtimeMetrics(container: string): Promise<string> {
  return docker([
    'exec',
    container,
    'node',
    '-e',
    "fetch('http://localhost:3000/metrics').then(r=>r.text()).then(t=>process.stdout.write(t))",
  ]);
}

/** The value of one sample of a Prometheus text, summed over its label sets; 0 when it is not there. */
export function metricValue(text: string, name: string): number {
  let total = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || !line.startsWith(name)) continue;
    const rest = line.slice(name.length);
    if (rest[0] !== ' ' && rest[0] !== '{') continue;
    total += Number.parseFloat(line.slice(line.lastIndexOf(' ') + 1)) || 0;
  }
  return total;
}
