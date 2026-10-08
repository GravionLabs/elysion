// `pnpm dev:stack` / `pnpm dev:stack:down`: the whole stack in containers behind Traefik, built from this checkout, with
// the host ports of docker-compose.dev.yml on top (Postgres, Valkey, the Traefik dashboard). It is the same stack as
// `pnpm demo` (docker-compose.yml); nothing else has to be running (ADR 0023).
import { spawnSync } from 'node:child_process';

const COMPOSE = ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.dev.yml'];
const ACTIONS = { up: ['up', '-d', '--build', '--remove-orphans'], down: ['down'] };

const action = process.argv[2];
if (!ACTIONS[action]) {
  console.error(`Usage: node scripts/dev-stack.mjs <${Object.keys(ACTIONS).join('|')}>`);
  process.exit(2);
}

const result = spawnSync('docker', [...COMPOSE, ...ACTIONS[action]], { stdio: 'inherit' });
if (result.status === 0 && action === 'up') {
  console.log(
    '\nElysion is up: http://localhost/ (Traefik dashboard: http://localhost:8080/dashboard/)',
  );
}
process.exit(result.status ?? 1);
