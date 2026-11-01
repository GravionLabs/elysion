// `pnpm dev:stack` / `pnpm dev:logs` / `pnpm dev:stack:down`: the whole stack in containers behind Traefik, built from this
// checkout, with the host ports of docker-compose.dev.yml on top (Postgres, Valkey, the Traefik dashboard). It is the same
// stack as `pnpm demo` (docker-compose.yml); nothing else has to be running (ADR 0023). `pnpm dev:infra` starts only the
// infrastructure, for apps run on the host.
//
// `logs` is `up` plus the log viewer (the Aspire dashboard, the `logs` profile of docker-compose.yml, ADR 0034): the three
// services ship their log lines to it and Traefik its access log, through a generated copy of its static configuration.
//
// Which stack: ELYSION_STACK and ELYSION_PORT_OFFSET (environment or the root .env, scripts/dev-stack-config.mjs, #890). A
// second worktree sets both and gets its own project, volumes and ports; without them this is the one stack `elysion`.
//
//   node scripts/dev-stack.mjs <infra|infra-down|up|logs|observability|down|check|env> [more arguments for compose]
//   `check` runs scripts/demo-smoke.sh against the stack; `env` prints `export` lines for a shell (`eval "$(...)"`) with the
//   stack's compose variables, the browser tests' addresses and the business backend's settings on the host.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { composeEnvironment, currentStack, hostAppSettings } from './dev-stack-config.mjs';
import { forStack, withOtlpAccessLog } from './traefik-logs-config.mjs';

const COMPOSE = ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.dev.yml'];
const OBSERVABILITY = [...COMPOSE, '-f', 'docker-compose.observability.yml'];
const INFRA_SERVICES = ['traefik', 'postgres', 'keycloak', 'valkey', 'rustfs'];
// `down` includes the profile, otherwise the viewer's container would outlive the stack it belongs to.
const ACTIONS = {
  infra: [...COMPOSE, 'up', '-d'],
  'infra-down': [...COMPOSE, 'down'],
  up: [...COMPOSE, 'up', '-d', '--build', '--remove-orphans'],
  logs: [...COMPOSE, '--profile', 'logs', 'up', '-d', '--build', '--remove-orphans'],
  // Prometheus, Alertmanager and Grafana (docker-compose.observability.yml, docs/operations.md).
  observability: [...OBSERVABILITY, 'up', '-d', '--build', '--remove-orphans'],
  down: [...OBSERVABILITY, '--profile', 'logs', 'down'],
  check: null,
  env: null,
};

// The dashboard's OTLP endpoints on the compose network: HTTP (protobuf) for the three services, gRPC for Traefik, whose
// HTTP exporter gzips every batch, which the dashboard refuses (scripts/traefik-logs-config.mjs).
const VIEWER_ENDPOINT = 'http://aspire-dashboard:18890/v1/logs';
const TRAEFIK_VIEWER_ENDPOINT = 'aspire-dashboard:18889';
const GENERATED_TRAEFIK_CONFIG = 'infra/traefik/.traefik.generated.yml';

const [action, ...extra] = process.argv.slice(2);
if (!(action in ACTIONS)) {
  console.error(
    `Usage: node scripts/dev-stack.mjs <${Object.keys(ACTIONS).join('|')}> [arguments]`,
  );
  process.exit(2);
}

let stack;
try {
  stack = currentStack();
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
const env = { ...process.env, ...composeEnvironment(stack) };

// Traefik's static configuration is one file: another stack's network and constraint, and the log export, go into a copy.
function writeTraefikConfig(withLogs) {
  if (stack.name === 'elysion' && !withLogs) return;
  let config = readFileSync('infra/traefik/traefik.yml', 'utf8');
  if (stack.name !== 'elysion') config = forStack(config, stack.name);
  if (withLogs) config = withOtlpAccessLog(config, TRAEFIK_VIEWER_ENDPOINT);
  writeFileSync(GENERATED_TRAEFIK_CONFIG, config);
  env.TRAEFIK_STATIC_CONFIG = `./${GENERATED_TRAEFIK_CONFIG}`;
}

const quote = (value) => `'${value.replaceAll("'", `'\\''`)}'`;

if (action === 'env') {
  writeTraefikConfig(false);
  const lines = {
    ...composeEnvironment(stack),
    ...(env.TRAEFIK_STATIC_CONFIG ? { TRAEFIK_STATIC_CONFIG: env.TRAEFIK_STATIC_CONFIG } : {}),
    E2E_BASE_URL: stack.urls.app,
    E2E_KEYCLOAK_URL: stack.urls.keycloak,
    ...hostAppSettings(stack).backend,
  };
  for (const [name, value] of Object.entries(lines)) console.log(`export ${name}=${quote(value)}`);
  process.exit(0);
}

if (action === 'check') {
  const args = extra.length > 0 ? extra : [stack.urls.app, stack.urls.keycloak];
  const result = spawnSync('bash', ['scripts/demo-smoke.sh', ...args], { stdio: 'inherit', env });
  process.exit(result.status ?? 1);
}

if (action === 'infra') {
  const setup = spawnSync(process.execPath, ['scripts/setup-dev-env.mjs'], {
    stdio: 'inherit',
    env,
  });
  if (setup.status !== 0) process.exit(setup.status ?? 1);
}
if (['infra', 'up', 'logs', 'observability'].includes(action))
  writeTraefikConfig(action === 'logs');
if (action === 'logs') env.LOGS_OTLP_ENDPOINT = VIEWER_ENDPOINT;

const args = [...ACTIONS[action], ...extra, ...(action === 'infra' ? INFRA_SERVICES : [])];
const result = spawnSync('docker', args, { stdio: 'inherit', env });
if (result.status === 0 && !action.endsWith('down')) {
  const { ports, urls } = stack;
  console.log(
    `\nElysion (stack ${stack.name}) is up: ${urls.app}/ (Keycloak: ${urls.keycloak}, Traefik dashboard: http://localhost:${ports.traefikDashboard}/dashboard/)`,
  );
  if (action === 'observability') {
    console.log(
      `Grafana: http://localhost:${process.env.GRAFANA_PORT ?? '3030'}  Prometheus: http://localhost:${process.env.PROMETHEUS_PORT ?? '9090'}  Alertmanager: http://localhost:${process.env.ALERTMANAGER_PORT ?? '9093'}`,
    );
  }
  if (action === 'logs') {
    const port = env.ASPIRE_DASHBOARD_PORT ?? '18888';
    console.log(
      `The logs of all four components (Aspire dashboard): http://localhost:${port}/structuredlogs (filter: requestId = <id>)`,
    );
  }
}
process.exit(result.status ?? 1);
