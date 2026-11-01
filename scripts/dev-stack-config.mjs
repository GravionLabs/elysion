// Which dev stack a checkout runs (#890): its compose project name and every host port, derived from two settings so that
// several stacks can run side by side, one per git worktree.
//
//   ELYSION_STACK         the compose project name (default `elysion`: the volumes, the network and the containers are
//                         prefixed with it, so two stacks never share a database)
//   ELYSION_PORT_OFFSET   added to every host port (default 0); a multiple of 10 below 1000, so that no port of one stack
//                         lands on another port of any stack (the default ports differ by 1, 2 and by multiples of 10 of
//                         1020 and more)
//
// Both are read from the environment and then from the root `.env` (git-ignored, so a worktree keeps its own). Unset, the
// stack is today's: project `elysion`, http://localhost, Keycloak on 8081, and compose gets no variable from here, so a
// value in `.env` (KEYCLOAK_PORT, VALKEY_PORT, ...) keeps working as before. Used by scripts/dev-stack.mjs (the compose
// commands, `pnpm demo:check`), scripts/setup-dev-env.mjs, the Angular dev server's proxy and the browser tests.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_STACK = 'elysion';

/** Today's host ports: what a stack without settings publishes, and what an offset is added to. */
export const DEFAULT_PORTS = Object.freeze({
  traefik: 80,
  traefikDashboard: 8080,
  keycloak: 8081,
  postgres: 5432,
  valkey: 6380,
  rustfsS3: 9100,
  rustfsConsole: 9101,
  aspireDashboard: 18888,
  aspireDashboardOtlp: 18890,
  // The apps run on the host (`pnpm dev:infra`): the BFF, the realtime service, the business backend and `ng serve`.
  bff: 3000,
  realtime: 3001,
  backend: 5174,
  frontendDev: 4200,
});

/** The compose variable of each published port (docker-compose.yml and docker-compose.dev.yml read them). */
const COMPOSE_PORT_VARIABLES = Object.freeze({
  traefik: 'TRAEFIK_PORT',
  traefikDashboard: 'TRAEFIK_DASHBOARD_PORT',
  keycloak: 'KEYCLOAK_PORT',
  postgres: 'POSTGRES_PORT',
  valkey: 'VALKEY_PORT',
  rustfsS3: 'RUSTFS_S3_PORT',
  rustfsConsole: 'RUSTFS_CONSOLE_PORT',
  aspireDashboard: 'ASPIRE_DASHBOARD_PORT',
  aspireDashboardOtlp: 'ASPIRE_DASHBOARD_OTLP_PORT',
});

const MAX_OFFSET = 1000;
// What compose accepts as a project name.
const STACK_NAME = /^[a-z0-9][a-z0-9_-]*$/;

/** The `NAME=value` lines of a dotenv file (no expansion, quotes removed); an absent file is empty. */
export function readDotenv(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

const url = (port, path = '') => `http://localhost${port === 80 ? '' : `:${port}`}${path}`;

/**
 * The stack of these settings.
 * @param {Record<string, string | undefined>} env the environment (process.env), which wins over `dotenv`
 * @param {Record<string, string | undefined>} [dotenv] the values of the root `.env`
 */
export function stackSettings(env, dotenv = {}) {
  const setting = (name) => {
    const value = env[name] ?? dotenv[name];
    return value === undefined || value.trim() === '' ? undefined : value.trim();
  };

  const name = setting('ELYSION_STACK') ?? DEFAULT_STACK;
  if (!STACK_NAME.test(name)) {
    throw new Error(
      `ELYSION_STACK=${name} is not a compose project name (lower-case letters, digits, - and _)`,
    );
  }
  const rawOffset = setting('ELYSION_PORT_OFFSET') ?? '0';
  const offset = /^\d+$/.test(rawOffset) ? Number(rawOffset) : NaN;
  if (!(offset < MAX_OFFSET) || offset % 10 !== 0) {
    throw new Error(
      `ELYSION_PORT_OFFSET=${rawOffset} must be a multiple of 10 from 0 to ${MAX_OFFSET - 10}`,
    );
  }
  if (name === DEFAULT_STACK && offset !== 0) {
    throw new Error(
      `ELYSION_PORT_OFFSET=${offset} needs its own ELYSION_STACK: the stack \`${DEFAULT_STACK}\` has the default ports`,
    );
  }

  const ports = Object.fromEntries(
    Object.entries(DEFAULT_PORTS).map(([key, port]) => [key, port + offset]),
  );
  const urls = {
    app: url(ports.traefik),
    keycloak: url(ports.keycloak),
    issuer: url(ports.keycloak, '/realms/elysion'),
    frontendDev: url(ports.frontendDev),
    bff: url(ports.bff),
    realtime: url(ports.realtime),
    backend: url(ports.backend),
    aspireDashboard: url(ports.aspireDashboard),
  };
  return { name, offset, isDefault: offset === 0 && name === DEFAULT_STACK, ports, urls };
}

/**
 * The variables compose gets for a stack (on top of the environment): none for today's stack, so that compose and `.env`
 * decide exactly as before; for another one its project name, its ports and the addresses that contain a port.
 * @param {ReturnType<typeof stackSettings>} stack
 */
export function composeEnvironment(stack) {
  if (stack.isDefault) return {};
  const variables = { COMPOSE_PROJECT_NAME: stack.name };
  if (stack.offset === 0) return variables;
  for (const [key, variable] of Object.entries(COMPOSE_PORT_VARIABLES)) {
    variables[variable] = String(stack.ports[key]);
  }
  // The dev realm's redirect URIs and web origins (infra/keycloak, read when Keycloak imports it) and the edge's CORS origins.
  variables.ELYSION_DEV_APP_URL = stack.urls.app;
  variables.ELYSION_DEV_FRONTEND_URL = stack.urls.frontendDev;
  variables.CORS_ALLOWED_ORIGINS = `${stack.urls.app},${stack.urls.frontendDev}`;
  return variables;
}

/**
 * The settings of the apps run on the host against a stack (their `.env`, the backend's environment), which differ from the
 * committed defaults only for a stack with an offset.
 * @param {ReturnType<typeof stackSettings>} stack
 */
export function hostAppSettings(stack) {
  const { ports, urls } = stack;
  return {
    bff: {
      PORT: String(ports.bff),
      BUSINESS_BACKEND_URL: urls.backend,
      OIDC_ISSUER_URL: urls.issuer,
    },
    realtime: {
      PORT: String(ports.realtime),
      REDIS_URL: `redis://:dev-only-valkey-password@localhost:${ports.valkey}`,
      BUSINESS_BACKEND_URL: urls.backend,
    },
    // ASP.NET Core reads these from the environment over appsettings.Development.json (`__` is the section separator).
    backend: {
      ASPNETCORE_URLS: urls.backend,
      ConnectionStrings__Elysion: `Host=localhost;Port=${ports.postgres};Database=elysion;Username=elysion;Password=elysion`,
      S3_ENDPOINT: `http://localhost:${ports.rustfsS3}`,
      OIDC_ISSUER_URL: urls.issuer,
    },
  };
}

/** The stack of this checkout: the environment, then `<root>/.env`. */
export function currentStack(root = join(dirname(fileURLToPath(import.meta.url)), '..')) {
  return stackSettings(process.env, readDotenv(join(root, '.env')));
}
