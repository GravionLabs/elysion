import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readDotenv, stackSettings } from '../../scripts/dev-stack-config.mjs';
import { setupDevEnv } from '../../scripts/setup-dev-env.mjs';

const repo = new URL('../../', import.meta.url);
const quiet = { log() {}, warn() {} };

/** A checkout with the two `.env.example` files and no `.env`. */
function checkout() {
  const root = mkdtempSync(join(tmpdir(), 'elysion-setup-'));
  for (const app of ['bff', 'realtime']) {
    mkdirSync(join(root, 'apps', app), { recursive: true });
    copyFileSync(
      new URL(`apps/${app}/.env.example`, repo),
      join(root, 'apps', app, '.env.example'),
    );
  }
  return root;
}

/** Runs setup:env with a recording stand-in for `dotnet user-secrets set`. */
function run(root, settings) {
  const stored = [];
  setupDevEnv({
    root,
    stack: stackSettings(settings),
    storeUserSecret: (_root, value) => stored.push(value) > 0,
    log: quiet,
  });
  return stored;
}

describe('pnpm setup:env and the backend user secrets (#890)', () => {
  it('stores the realtime service secret in the user secrets for the default stack', () => {
    const root = checkout();
    const stored = run(root, {});
    const realtime = readDotenv(join(root, 'apps/realtime/.env'));
    assert.deepEqual(stored, [realtime.INTERNAL_API_SECRET]);
    assert.equal(realtime.INTERNAL_API_SECRET.length, 43);
  });

  it('never touches the user secrets, which every worktree shares, for another stack', () => {
    const root = checkout();
    const stored = run(root, { ELYSION_STACK: 'elysion-b', ELYSION_PORT_OFFSET: '10' });
    assert.deepEqual(stored, []);
    const realtime = readDotenv(join(root, 'apps/realtime/.env'));
    assert.equal(realtime.INTERNAL_API_SECRET.length, 43);
    assert.equal(realtime.PORT, '3011');
    assert.equal(readDotenv(join(root, 'apps/bff/.env')).WS_TOKEN_SECRET, realtime.WS_TOKEN_SECRET);
  });

  it('changes nothing when the .env files exist', () => {
    const root = checkout();
    run(root, {});
    const before = readFileSync(join(root, 'apps/realtime/.env'), 'utf8');
    assert.deepEqual(run(root, {}), []);
    assert.equal(readFileSync(join(root, 'apps/realtime/.env'), 'utf8'), before);
  });

  it('warns and keeps the .env when the user secret cannot be stored', () => {
    const root = checkout();
    const warnings = [];
    setupDevEnv({
      root,
      stack: stackSettings({}),
      storeUserSecret: () => false,
      log: { log() {}, warn: (message) => warnings.push(message) },
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /dotnet user-secrets set INTERNAL_API_SECRET/);
    assert.ok(readDotenv(join(root, 'apps/realtime/.env')).INTERNAL_API_SECRET);
  });
});
