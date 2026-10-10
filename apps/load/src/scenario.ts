import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ScenarioEvent =
  /** Every client drops its connection and reconnects, spread over `withinMs` (all reconnect within a few seconds). */
  | { atMs: number; action: 'reconnect-all'; withinMs: number }
  /** The first realtime replica is killed (no clean shutdown) and started again `restartAfterMs` later. */
  | { atMs: number; action: 'kill-replica'; restartAfterMs: number };

export interface Scenario {
  name: string;
  description: string;
  clients: number;
  boards: number;
  /** How long the clients write. */
  durationMs: number;
  /** The clients connect spread over this time, so that the token endpoint is not asked 200 times in one instant. */
  rampMs: number;
  writeEveryMs: number;
  events: ScenarioEvent[];
  /** The run fails when the p95 of the propagation latency is above this. */
  maxP95Ms?: number;
  /** The run fails when a client's last write is missing from the final document. Default true. */
  requireNoLoss?: boolean;
}

const SCENARIOS = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'scenarios');

/** A scenario by name (a file in `scenarios/`) or by path. */
export function loadScenario(nameOrPath: string): Scenario {
  const path = nameOrPath.endsWith('.json') ? nameOrPath : join(SCENARIOS, `${nameOrPath}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as Scenario;
}
