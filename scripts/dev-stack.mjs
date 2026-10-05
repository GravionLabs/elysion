// `pnpm dev:stack` / `pnpm dev:stack:down`: the whole stack in containers behind Traefik.
// Needs the shared local-infra Valkey (ADR 0006), so it checks that first like the VS Code task does.
import { spawnSync } from 'node:child_process';

const COMPOSE = ['compose', '-f', 'infra/docker/docker-compose.yml', '--profile', 'apps'];
const ACTIONS = { up: ['up', '-d', '--build', '--remove-orphans'], down: ['down'] };

const action = process.argv[2];
if (!ACTIONS[action]) {
  console.error(`Usage: node scripts/dev-stack.mjs <${Object.keys(ACTIONS).join('|')}>`);
  process.exit(2);
}

if (action === 'up') {
  const valkey = spawnSync(
    'docker',
    ['inspect', '-f', '{{.State.Running}}', 'local-infra-valkey-1'],
    {
      encoding: 'utf8',
    },
  );
  if (valkey.stdout?.trim() !== 'true') {
    console.error(
      'local-infra is not running. Start it first:\n  cd ../local-infra && docker compose up -d',
    );
    process.exit(1);
  }
}

const result = spawnSync('docker', [...COMPOSE, ...ACTIONS[action]], { stdio: 'inherit' });
if (result.status === 0 && action === 'up') {
  console.log(
    '\nElysion is up: http://localhost/ (Traefik dashboard: http://localhost:8080/dashboard/)',
  );
}
process.exit(result.status ?? 1);
