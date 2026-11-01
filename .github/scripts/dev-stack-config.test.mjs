import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  composeEnvironment,
  currentStack,
  hostAppSettings,
  readDotenv,
  shellEnvironment,
  stackSettings,
  usesUserSecrets,
} from '../../scripts/dev-stack-config.mjs';

const ALL_PORTS = (stack) => Object.values(stack.ports);

describe('the dev stack of a checkout (#890)', () => {
  it("is today's stack without settings: project elysion, the known ports, and no variable for compose", () => {
    const stack = stackSettings({});
    assert.equal(stack.name, 'elysion');
    assert.equal(stack.isDefault, true);
    assert.deepEqual(stack.ports, {
      traefik: 80,
      traefikDashboard: 8080,
      keycloak: 8081,
      postgres: 5432,
      valkey: 6380,
      rustfsS3: 9100,
      rustfsConsole: 9101,
      aspireDashboard: 18888,
      aspireDashboardOtlp: 18890,
      bff: 3000,
      realtime: 3001,
      backend: 5174,
      frontendDev: 4200,
    });
    assert.equal(stack.urls.app, 'http://localhost');
    assert.equal(stack.urls.keycloak, 'http://localhost:8081');
    assert.equal(stack.urls.issuer, 'http://localhost:8081/realms/elysion');
    assert.deepEqual(composeEnvironment(stack), {});
  });

  it('treats empty settings as unset', () => {
    assert.equal(stackSettings({ ELYSION_STACK: '', ELYSION_PORT_OFFSET: ' ' }).isDefault, true);
  });

  it('moves every port by the offset and names the project', () => {
    const stack = stackSettings({ ELYSION_STACK: 'elysion-b', ELYSION_PORT_OFFSET: '10' });
    assert.equal(stack.isDefault, false);
    assert.equal(stack.ports.traefik, 90);
    assert.equal(stack.ports.keycloak, 8091);
    assert.equal(stack.ports.valkey, 6390);
    assert.equal(stack.ports.aspireDashboardOtlp, 18900);
    assert.equal(stack.ports.frontendDev, 4210);
    assert.equal(stack.urls.app, 'http://localhost:90');
    assert.equal(stack.urls.issuer, 'http://localhost:8091/realms/elysion');
  });

  it('gives compose the project, every published port and the addresses with a port', () => {
    const env = composeEnvironment(
      stackSettings({ ELYSION_STACK: 'elysion-b', ELYSION_PORT_OFFSET: '20' }),
    );
    assert.deepEqual(env, {
      COMPOSE_PROJECT_NAME: 'elysion-b',
      TRAEFIK_PORT: '100',
      TRAEFIK_DASHBOARD_PORT: '8100',
      KEYCLOAK_PORT: '8101',
      POSTGRES_PORT: '5452',
      VALKEY_PORT: '6400',
      RUSTFS_S3_PORT: '9120',
      RUSTFS_CONSOLE_PORT: '9121',
      ASPIRE_DASHBOARD_PORT: '18908',
      ASPIRE_DASHBOARD_OTLP_PORT: '18910',
      ELYSION_DEV_APP_URL: 'http://localhost:100',
      ELYSION_DEV_FRONTEND_URL: 'http://localhost:4220',
      CORS_ALLOWED_ORIGINS: 'http://localhost:100,http://localhost:4220',
    });
  });

  it('gives a named stack without an offset only its project name', () => {
    assert.deepEqual(composeEnvironment(stackSettings({ ELYSION_STACK: 'ci' })), {
      COMPOSE_PROJECT_NAME: 'ci',
    });
  });

  it('never lets a port of one stack land on a port of another, for any two allowed offsets', () => {
    for (let a = 0; a < 1000; a += 10) {
      for (let b = a + 10; b < 1000; b += 10) {
        const first = ALL_PORTS(stackSettings({ ELYSION_STACK: 'a', ELYSION_PORT_OFFSET: `${a}` }));
        const second = ALL_PORTS(
          stackSettings({ ELYSION_STACK: 'b', ELYSION_PORT_OFFSET: `${b}` }),
        );
        const shared = first.filter((port) => second.includes(port));
        assert.deepEqual(shared, [], `offsets ${a} and ${b} share ${shared}`);
      }
    }
  });

  it('gives the apps on the host their ports and the stack addresses', () => {
    const apps = hostAppSettings(
      stackSettings({ ELYSION_STACK: 'elysion-b', ELYSION_PORT_OFFSET: '10' }),
    );
    assert.deepEqual(apps.bff, {
      PORT: '3010',
      BUSINESS_BACKEND_URL: 'http://localhost:5184',
      OIDC_ISSUER_URL: 'http://localhost:8091/realms/elysion',
    });
    assert.equal(apps.realtime.PORT, '3011');
    assert.equal(apps.realtime.REDIS_URL, 'redis://:dev-only-valkey-password@localhost:6390');
    assert.equal(
      apps.backend.ConnectionStrings__Elysion,
      'Host=localhost;Port=5442;Database=elysion;Username=elysion;Password=elysion',
    );
    assert.equal(apps.backend.S3_ENDPOINT, 'http://localhost:9110');
    assert.equal(apps.backend.ASPNETCORE_URLS, 'http://localhost:5184');
  });

  it('gives the backend what its launch profile sets, since dev:env runs it with --no-launch-profile', () => {
    const launch = JSON.parse(
      readFileSync(
        new URL(
          '../../apps/business-backend/src/Elysion.BusinessBackend.Api/Properties/launchSettings.json',
          import.meta.url,
        ),
        'utf8',
      ).replace(/^\uFEFF/, ''),
    ).profiles.http;
    const backend = hostAppSettings(
      stackSettings({ ELYSION_STACK: 'elysion-b', ELYSION_PORT_OFFSET: '10' }),
    ).backend;
    assert.equal(backend.ASPNETCORE_ENVIRONMENT, 'Development');
    assert.equal(backend.Database__MigrateOnStartup, 'true');
    assert.deepEqual(
      Object.fromEntries(
        Object.keys(launch.environmentVariables).map((name) => [name, backend[name]]),
      ),
      launch.environmentVariables,
    );
  });

  it('keeps the user secrets for the default stack only', () => {
    assert.equal(usesUserSecrets(stackSettings({})), true);
    assert.equal(usesUserSecrets(stackSettings({ ELYSION_STACK: 'ci' })), false);
    assert.equal(
      usesUserSecrets(stackSettings({ ELYSION_STACK: 'elysion-b', ELYSION_PORT_OFFSET: '10' })),
      false,
    );
  });

  it("exports for another stack's backend the internal secret of the worktree's realtime .env", () => {
    const stack = stackSettings({ ELYSION_STACK: 'elysion-b', ELYSION_PORT_OFFSET: '10' });
    const env = shellEnvironment(stack, {
      realtimeDotenv: { INTERNAL_API_SECRET: 'secret-of-worktree-b', PORT: '3011' },
      traefikStaticConfig: './infra/traefik/.traefik.generated.yml',
    });
    assert.equal(env.INTERNAL_API_SECRET, 'secret-of-worktree-b');
    assert.equal(env.COMPOSE_PROJECT_NAME, 'elysion-b');
    assert.equal(env.TRAEFIK_STATIC_CONFIG, './infra/traefik/.traefik.generated.yml');
    assert.equal(env.E2E_BASE_URL, 'http://localhost:90');
    assert.equal(env.ASPNETCORE_ENVIRONMENT, 'Development');
    assert.equal(env.Database__MigrateOnStartup, 'true');
    assert.equal(env.PORT, undefined);
    assert.equal(shellEnvironment(stack).INTERNAL_API_SECRET, undefined);
  });

  it('exports no internal secret for the default stack, whose backend has it in the user secrets', () => {
    const env = shellEnvironment(stackSettings({}), {
      realtimeDotenv: { INTERNAL_API_SECRET: 'secret' },
    });
    assert.equal(env.INTERNAL_API_SECRET, undefined);
    assert.equal(env.TRAEFIK_STATIC_CONFIG, undefined);
    assert.equal(env.COMPOSE_PROJECT_NAME, undefined);
  });

  for (const offset of ['5', '1000', '-10', 'ten', '1e1']) {
    it(`refuses the offset ${offset}`, () => {
      assert.throws(
        () => stackSettings({ ELYSION_STACK: 'b', ELYSION_PORT_OFFSET: offset }),
        /multiple of 10/,
      );
    });
  }

  it('refuses an offset for the default stack, whose ports another checkout expects', () => {
    assert.throws(() => stackSettings({ ELYSION_PORT_OFFSET: '10' }), /its own ELYSION_STACK/);
  });

  it('refuses a name compose would not take', () => {
    assert.throws(() => stackSettings({ ELYSION_STACK: 'Elysion B' }), /project name/);
  });

  it('reads the settings from the root .env, with the environment winning', () => {
    const root = mkdtempSync(join(tmpdir(), 'elysion-stack-'));
    writeFileSync(
      join(root, '.env'),
      '# a comment\nELYSION_STACK="elysion-b"\nexport ELYSION_PORT_OFFSET=30\nKEYCLOAK_PORT=8081\n',
    );
    assert.deepEqual(readDotenv(join(root, '.env')), {
      ELYSION_STACK: 'elysion-b',
      ELYSION_PORT_OFFSET: '30',
      KEYCLOAK_PORT: '8081',
    });
    const fromFile = stackSettings({}, readDotenv(join(root, '.env')));
    assert.equal(fromFile.name, 'elysion-b');
    assert.equal(fromFile.ports.traefik, 110);
    const overridden = stackSettings({ ELYSION_PORT_OFFSET: '40' }, readDotenv(join(root, '.env')));
    assert.equal(overridden.ports.traefik, 120);
  });

  it('has no settings in a checkout without a .env', () => {
    const saved = { stack: process.env.ELYSION_STACK, offset: process.env.ELYSION_PORT_OFFSET };
    delete process.env.ELYSION_STACK;
    delete process.env.ELYSION_PORT_OFFSET;
    try {
      assert.equal(currentStack(mkdtempSync(join(tmpdir(), 'elysion-stack-'))).isDefault, true);
    } finally {
      if (saved.stack !== undefined) process.env.ELYSION_STACK = saved.stack;
      if (saved.offset !== undefined) process.env.ELYSION_PORT_OFFSET = saved.offset;
    }
  });

  it('names in the compose files the same variables and defaults as the derivation', () => {
    const compose = ['docker-compose.yml', 'docker-compose.dev.yml']
      .map((file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'))
      .join('\n');
    const defaults = stackSettings({}).ports;
    const offset = composeEnvironment(
      stackSettings({ ELYSION_STACK: 'b', ELYSION_PORT_OFFSET: '10' }),
    );
    for (const [variable, value] of Object.entries(offset)) {
      if (!variable.endsWith('_PORT')) continue;
      const port = Number(value) - 10;
      assert.ok(Object.values(defaults).includes(port));
      assert.ok(
        compose.includes(`\${${variable}:-${port}}`),
        `no \${${variable}:-${port}} in compose`,
      );
    }
    for (const variable of [
      'ELYSION_DEV_APP_URL',
      'ELYSION_DEV_FRONTEND_URL',
      'CORS_ALLOWED_ORIGINS',
    ]) {
      assert.ok(compose.includes(`\${${variable}:-`), `compose does not read ${variable}`);
    }
  });
});
