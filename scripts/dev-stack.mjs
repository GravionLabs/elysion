// `pnpm dev:stack` / `pnpm dev:logs` / `pnpm dev:stack:down`: the whole stack in containers behind Traefik, built from this
// checkout, with the host ports of docker-compose.dev.yml on top (Postgres, Valkey, the Traefik dashboard). It is the same
// stack as `pnpm demo` (docker-compose.yml); nothing else has to be running (ADR 0023).
//
// `logs` is `up` plus the log viewer (VictoriaLogs, the `logs` profile of docker-compose.yml, ADR 0025): the three services
// ship their log lines to it and Traefik its access log, through a generated copy of its static configuration.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { withOtlpAccessLog } from './traefik-logs-config.mjs';

const COMPOSE = ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.dev.yml'];
const OBSERVABILITY = [...COMPOSE, '-f', 'docker-compose.observability.yml'];
// `down` includes the profile, otherwise the viewer's container would outlive the stack it belongs to.
const ACTIONS = {
  up: [...COMPOSE, 'up', '-d', '--build', '--remove-orphans'],
  logs: [...COMPOSE, '--profile', 'logs', 'up', '-d', '--build', '--remove-orphans'],
  // Prometheus, Alertmanager and Grafana (docker-compose.observability.yml, docs/operations.md).
  observability: [...OBSERVABILITY, 'up', '-d', '--build', '--remove-orphans'],
  down: [...OBSERVABILITY, '--profile', 'logs', 'down'],
};

const VIEWER_ENDPOINT = 'http://victorialogs:9428/insert/opentelemetry/v1/logs';
const GENERATED_TRAEFIK_CONFIG = 'infra/traefik/.traefik.logs.yml';

const action = process.argv[2];
if (!ACTIONS[action]) {
  console.error(`Usage: node scripts/dev-stack.mjs <${Object.keys(ACTIONS).join('|')}>`);
  process.exit(2);
}

const env = { ...process.env };
if (action === 'logs') {
  writeFileSync(
    GENERATED_TRAEFIK_CONFIG,
    withOtlpAccessLog(readFileSync('infra/traefik/traefik.yml', 'utf8'), VIEWER_ENDPOINT),
  );
  env.TRAEFIK_STATIC_CONFIG = `./${GENERATED_TRAEFIK_CONFIG}`;
  env.LOGS_OTLP_ENDPOINT = VIEWER_ENDPOINT;
}

const result = spawnSync('docker', ACTIONS[action], { stdio: 'inherit', env });
if (result.status === 0 && action !== 'down') {
  console.log(
    '\nElysion is up: http://localhost/ (Traefik dashboard: http://localhost:8080/dashboard/)',
  );
  if (action === 'observability') {
    console.log(
      `Grafana: http://localhost:${process.env.GRAFANA_PORT ?? '3030'}  Prometheus: http://localhost:${process.env.PROMETHEUS_PORT ?? '9090'}  Alertmanager: http://localhost:${process.env.ALERTMANAGER_PORT ?? '9093'}`,
    );
  }
  if (action === 'logs') {
    const port = process.env.VICTORIALOGS_PORT ?? '9428';
    console.log(
      `The logs of all four components: http://localhost:${port}/select/vmui (query: requestId:"<id>")`,
    );
  }
}
process.exit(result.status ?? 1);
