import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session, stackFromEnv } from './auth.js';
import { LoadClient, readDocument } from './client.js';
import { containerUse, containersOf, docker, metricValue, realtimeMetrics } from './docker.js';
import { type Scenario, loadScenario } from './scenario.js';
import { Samples, formatMs } from './stats.js';

/** What `pnpm test:load -- --scenario <name>` does: see AGENTS.md. */

const args = process.argv.slice(2);
const scenarioArg = args[args.indexOf('--scenario') + 1];
if (!scenarioArg || !args.includes('--scenario')) {
  console.error(
    'usage: pnpm test:load -- --scenario <smoke|one-board|many-boards|reconnect-storm|replica-kill|path.json>',
  );
  process.exit(2);
}

const scenario = loadScenario(scenarioArg);
const stack = stackFromEnv();
const wsUrl = `${stack.app.replace(/^http/, 'ws')}/yjs`;
const log = (message: string) =>
  console.log(`[${((Date.now() - started) / 1000).toFixed(0).padStart(4)} s] ${message}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const started = Date.now();

interface Use {
  cpu: number[];
  memory: number[];
}

async function main(): Promise<number> {
  const session = new Session(stack);
  await session.start();
  const realtime = await containersOf('realtime');
  if (realtime.length === 0)
    throw new Error('no realtime container is running: start the stack first (pnpm dev:stack)');
  log(
    `${scenario.name}: ${scenario.clients} clients on ${scenario.boards} boards, ${realtime.length} realtime replicas (${realtime.join(', ')})`,
  );

  const watched = [
    ...realtime,
    ...(await containersOf('valkey')),
    ...(await containersOf('business-backend')),
    ...(await containersOf('bff')),
    ...(await containersOf('traefik')),
    ...(await containersOf('postgres')),
  ];
  const before = await scrape(realtime);
  const valkeyBefore = await valkeyCommands();

  const boardIds: string[] = [];
  for (let i = 0; i < scenario.boards; i++) {
    const board = await session.api<{ id: string }>('POST', '/boards', {
      name: `load ${scenario.name} ${i + 1}`,
    });
    boardIds.push(board.id);
  }

  const latency = new Samples();
  const counters = {
    connected: 0,
    closedOpen: 0,
    refusedConnects: 0,
    boardFull: 0,
    closes: new Map<number, number>(),
  };
  const clients: LoadClient[] = [];
  for (let i = 0; i < scenario.clients; i++) {
    const boardId = boardIds[i % boardIds.length]!;
    clients.push(
      new LoadClient({
        boardId,
        index: i,
        url: wsUrl,
        wsToken: () => session.wsToken(boardId),
        writeEveryMs: scenario.writeEveryMs,
        events: {
          onLatency: (ms) => latency.add(ms),
          onConnected: () => (counters.connected += 1),
          onClosed: (code, wasOpen) => {
            counters.closes.set(code, (counters.closes.get(code) ?? 0) + 1);
            if (wasOpen) counters.closedOpen += 1;
            else counters.refusedConnects += 1;
          },
          onBoardFull: () => (counters.boardFull += 1),
        },
      }),
    );
  }

  const use = new Map<string, Use>();
  const sampler = setInterval(() => {
    containerUse(watched)
      .then((rows) => {
        for (const row of rows) {
          const entry = use.get(row.name) ?? { cpu: [], memory: [] };
          entry.cpu.push(row.cpuPercent);
          entry.memory.push(row.memoryMiB);
          use.set(row.name, entry);
        }
      })
      .catch(() => undefined);
  }, 10_000);

  // Connect spread over the ramp, then write for the duration.
  clients.forEach((client, i) =>
    setTimeout(() => client.start(), (i / clients.length) * scenario.rampMs),
  );
  await sleep(scenario.rampMs);
  log(`all clients started; writing for ${scenario.durationMs / 1000} s`);
  const runStarted = Date.now();
  const timers: NodeJS.Timeout[] = [];
  const killed: string[] = [];
  for (const event of scenario.events) {
    timers.push(
      setTimeout(() => {
        if (event.action === 'reconnect-all') {
          log(`reconnect storm: ${clients.length} clients within ${event.withinMs / 1000} s`);
          clients.forEach((client) =>
            setTimeout(() => client.reconnectNow(), Math.random() * event.withinMs),
          );
        } else {
          const victim = realtime[0]!;
          log(`killing ${victim}`);
          killed.push(victim);
          void docker(['kill', victim]).catch((error: unknown) =>
            log(`kill failed: ${String(error)}`),
          );
          setTimeout(() => {
            log(`starting ${victim}`);
            void docker(['start', victim]).catch((error: unknown) =>
              log(`start failed: ${String(error)}`),
            );
          }, event.restartAfterMs);
        }
      }, event.atMs),
    );
  }
  await sleep(Math.max(0, scenario.durationMs - (Date.now() - runStarted)));
  timers.forEach(clearTimeout);

  clients.forEach((client) => client.stopWriting());
  log('writing stopped; letting the last updates settle');
  await sleep(8_000);
  const after = await scrape(
    (await containersOf('realtime')).length > 0 ? await containersOf('realtime') : realtime,
  );
  const valkeyAfter = await valkeyCommands();
  clearInterval(sampler);

  // The final documents: every client's last write has to be in them, whichever replica serves the read.
  const lost: string[] = [];
  const divergent: string[] = [];
  for (const boardId of boardIds) {
    const snapshots: Record<string, { n: number }>[] = [];
    for (let read = 0; read < 4; read++) {
      snapshots.push(await readDocument(wsUrl, boardId, await session.wsToken(boardId)));
    }
    const first = JSON.stringify(sortKeys(snapshots[0]!));
    if (snapshots.some((snapshot) => JSON.stringify(sortKeys(snapshot)) !== first))
      divergent.push(boardId);
    clients.forEach((client, i) => {
      if (boardIds[i % boardIds.length] !== boardId) return;
      const stored = snapshots[0]![`c${i}`]?.n ?? 0;
      if (stored < client.written)
        lost.push(`client ${i}: wrote ${client.written}, the board has ${stored}`);
    });
  }
  const reconnects = clients.reduce((sum, client) => sum + client.reconnects, 0);
  clients.forEach((client) => client.stop());
  for (const boardId of boardIds)
    await session.api('DELETE', `/boards/${boardId}`).catch(() => undefined);
  session.stop();

  const requireNoLoss = scenario.requireNoLoss ?? true;
  const p95 = latency.percentile(0.95);
  const report = render({
    scenario,
    replicas: realtime.length,
    latency,
    counters,
    reconnects,
    use,
    growth: growth(before, after),
    valkeyCommands: valkeyAfter - valkeyBefore,
    seconds: (Date.now() - runStarted) / 1000,
    lost,
    divergent,
    killed,
  });
  const dir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'reports');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${scenario.name}-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
  writeFileSync(file, report);
  console.log(report);
  log(`report: ${file}`);

  let failed = false;
  if (scenario.maxP95Ms !== undefined && !(p95 <= scenario.maxP95Ms)) {
    console.error(
      `FAILED: the p95 of the propagation latency is ${formatMs(p95)}, above ${scenario.maxP95Ms} ms`,
    );
    failed = true;
  }
  if (requireNoLoss && (lost.length > 0 || divergent.length > 0)) {
    console.error(
      `FAILED: ${lost.length} client(s) lost their last write, ${divergent.length} board(s) differ between reads`,
    );
    failed = true;
  }
  return failed ? 1 : 0;
}

function sortKeys<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

interface Scrape {
  connections: number;
  saves: number;
  saveFailures: number;
  saveSeconds: number;
  saveCount: number;
  refused: number;
  bytesSum: number;
  bytesCount: number;
}

/** The counters of every realtime container by name; a container that is down has nothing to scrape. */
async function scrape(names: string[]): Promise<Map<string, Scrape>> {
  const result = new Map<string, Scrape>();
  for (const name of names) {
    try {
      const text = await realtimeMetrics(name);
      result.set(name, {
        connections: metricValue(text, 'elysion_realtime_websocket_connections'),
        saves: metricValue(text, 'elysion_realtime_document_saves_total'),
        saveFailures: metricValue(text, 'elysion_realtime_document_save_failures_total'),
        saveSeconds: metricValue(text, 'elysion_realtime_document_save_duration_seconds_sum'),
        saveCount: metricValue(text, 'elysion_realtime_document_save_duration_seconds_count'),
        refused: metricValue(text, 'elysion_realtime_document_updates_refused_total'),
        bytesSum: metricValue(text, 'elysion_realtime_document_size_bytes_sum'),
        bytesCount: metricValue(text, 'elysion_realtime_document_size_bytes_count'),
      });
    } catch {
      // A replica that is down has nothing to scrape.
    }
  }
  return result;
}

/**
 * What the counters grew by between two scrapes, per container: a container that was restarted (the killed replica) starts
 * its counters at 0 again, so its growth is what it has now.
 */
function growth(before: Map<string, Scrape>, after: Map<string, Scrape>): Scrape {
  const total: Scrape = {
    connections: 0,
    saves: 0,
    saveFailures: 0,
    saveSeconds: 0,
    saveCount: 0,
    refused: 0,
    bytesSum: 0,
    bytesCount: 0,
  };
  for (const [name, now] of after) {
    const was = before.get(name);
    for (const key of Object.keys(total) as (keyof Scrape)[]) {
      const base = was && was[key] <= now[key] ? was[key] : 0;
      total[key] += now[key] - base;
    }
  }
  return total;
}

/** The commands Valkey has processed since it started; the difference of two readings is the throughput of a run. */
async function valkeyCommands(): Promise<number> {
  const [name] = await containersOf('valkey');
  if (!name) return 0;
  try {
    const out = await docker([
      'exec',
      name,
      'sh',
      '-c',
      'valkey-cli --no-auth-warning -a "$VALKEY_PASSWORD" info stats',
    ]);
    return Number(/total_commands_processed:(\d+)/.exec(out)?.[1] ?? 0);
  } catch {
    return 0;
  }
}

interface Rendered {
  scenario: Scenario;
  replicas: number;
  latency: Samples;
  counters: {
    connected: number;
    closedOpen: number;
    refusedConnects: number;
    boardFull: number;
    closes: Map<number, number>;
  };
  reconnects: number;
  use: Map<string, Use>;
  growth: Scrape;
  valkeyCommands: number;
  seconds: number;
  lost: string[];
  divergent: string[];
  killed: string[];
}

function render(r: Rendered): string {
  const saves = r.growth.saves;
  const saveMs =
    r.growth.saveCount > 0 ? (r.growth.saveSeconds / r.growth.saveCount) * 1000 : Number.NaN;
  const avgBytes = r.growth.bytesCount > 0 ? r.growth.bytesSum / r.growth.bytesCount : Number.NaN;
  const rows = [...r.use.entries()].map(([name, u]) => {
    const peak = Math.max(...u.memory);
    const cpu = u.cpu.reduce((a, b) => a + b, 0) / Math.max(1, u.cpu.length);
    return `| ${name} | ${cpu.toFixed(0)} % | ${Math.max(...u.cpu).toFixed(0)} % | ${peak.toFixed(0)} MiB |`;
  });
  const closes =
    [...r.counters.closes.entries()].map(([code, n]) => `${code}: ${n}`).join(', ') || 'none';
  return `# Load test: ${r.scenario.name}

${r.scenario.description}

- Date: ${new Date().toISOString()}
- Clients: ${r.scenario.clients} on ${r.scenario.boards} boards, each moving an element every ${r.scenario.writeEveryMs} ms for ${r.seconds.toFixed(0)} s
- Realtime replicas: ${r.replicas}${r.killed.length ? ` (killed: ${r.killed.join(', ')})` : ''}

## Results

| What | Value |
| --- | --- |
| Propagation latency p50 | ${formatMs(r.latency.percentile(0.5))} |
| Propagation latency p95 | ${formatMs(r.latency.percentile(0.95))} |
| Propagation latency p99 | ${formatMs(r.latency.percentile(0.99))} |
| Propagation latency max | ${formatMs(r.latency.max)} |
| Updates measured | ${r.latency.count} |
| Connections made | ${r.counters.connected} |
| Connections that went away while open | ${r.counters.closedOpen} |
| Connection attempts that never opened | ${r.counters.refusedConnects} |
| Reconnects (all clients) | ${r.reconnects} |
| Close codes | ${closes} |
| Updates refused (board full) | ${r.counters.boardFull} |
| Saves | ${saves} |
| Save duration (mean) | ${formatMs(saveMs)} |
| Failed saves | ${r.growth.saveFailures} |
| Mean size of a saved document | ${Number.isNaN(avgBytes) ? 'n/a' : `${(avgBytes / 1024).toFixed(1)} KiB`} |
| Valkey commands per second | ${(r.valkeyCommands / Math.max(1, r.seconds)).toFixed(0)} |
| Clients whose last write is missing | ${r.lost.length} |
| Boards whose reads differ | ${r.divergent.length} |

## Containers

| Container | CPU mean | CPU peak | Memory peak |
| --- | --- | --- | --- |
${rows.join('\n')}
${
  r.lost.length > 0
    ? `\n## Lost writes\n\n${r.lost
        .slice(0, 20)
        .map((line) => `- ${line}`)
        .join('\n')}\n`
    : ''
}`;
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(error);
  return 1;
});
