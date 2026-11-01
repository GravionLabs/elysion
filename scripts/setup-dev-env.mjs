// `pnpm setup:env` (also run by `pnpm dev:infra`, so the VS Code "Elysion: full stack" launch has it): creates the
// git-ignored `.env` files of the BFF and the realtime service from their `.env.example`, with fresh random secrets
// instead of the example values. It never touches a file that exists, so running it again changes nothing.
//
// - WS_TOKEN_SECRET is shared by the BFF and the realtime service (a new one, or the BFF's if its `.env` exists).
// - INTERNAL_API_SECRET is shared by the realtime service and the business backend (ADR 0017). The backend of the default
//   stack reads it from .NET user secrets (the `UserSecretsId` of its project), which win over `appsettings.Development.json`.
//   Those are per user, shared by every worktree, so another stack (ELYSION_STACK) never writes them: its backend gets the
//   secret of the worktree's `apps/realtime/.env` from `eval "$(pnpm --silent dev:env)"` instead.
// - A stack with a port offset (ELYSION_PORT_OFFSET, scripts/dev-stack-config.mjs, #890) also gets its ports and addresses:
//   the apps' PORT, the backend's URL, Keycloak's issuer and Valkey's port. The backend's own settings are environment
//   variables there (`eval "$(pnpm --silent dev:env)"`, AGENTS.md), since user secrets are shared by every worktree.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentStack, hostAppSettings, usesUserSecrets } from './dev-stack-config.mjs';

const BACKEND_PROJECT =
  'apps/business-backend/src/Elysion.BusinessBackend.Api/Elysion.BusinessBackend.Api.csproj';

const secret = () => randomBytes(32).toString('base64url'); // 43 characters, the services want at least 32

function readSetting(file, name) {
  if (!existsSync(file)) return undefined;
  return readFileSync(file, 'utf8')
    .match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]
    .trim();
}

/** Stores the backend's INTERNAL_API_SECRET in its .NET user secrets; true when that worked. */
function dotnetUserSecret(root, value) {
  const result = spawnSync(
    'dotnet',
    ['user-secrets', 'set', 'INTERNAL_API_SECRET', value, '--project', join(root, BACKEND_PROJECT)],
    { encoding: 'utf8' },
  );
  return result.status === 0;
}

/**
 * Creates the missing `.env` files of the checkout at `root` for its stack.
 * @param {{ root: string, stack: ReturnType<typeof currentStack>, storeUserSecret?: (root: string, value: string) => boolean, log?: Pick<Console, 'log' | 'warn'> }} options
 *   `storeUserSecret` writes the backend's user secret (replaced in the tests)
 */
export function setupDevEnv({ root, stack, storeUserSecret = dotnetUserSecret, log = console }) {
  const bffEnv = join(root, 'apps/bff/.env');
  const realtimeEnv = join(root, 'apps/realtime/.env');
  const shown = (path) => relative(root, path).replaceAll('\\', '/');

  // Copies `<dir>/.env.example` to `<dir>/.env` with the given settings replaced; false if `.env` already exists.
  function createEnv(file, values) {
    if (existsSync(file)) return false;
    let content = readFileSync(`${file}.example`, 'utf8');
    for (const [name, value] of Object.entries(values)) {
      const line = new RegExp(`^${name}=.*$`, 'm');
      if (!line.test(content)) throw new Error(`${shown(file)}.example has no ${name}= line`);
      content = content.replace(line, () => `${name}=${value}`);
    }
    writeFileSync(file, content);
    log.log(
      `setup:env created ${shown(file)} (${Object.keys(values).join(', ') || 'as in the example'})`,
    );
    return true;
  }

  const hostApps = stack.offset === 0 ? { bff: {}, realtime: {} } : hostAppSettings(stack);

  const wsTokenSecret = readSetting(bffEnv, 'WS_TOKEN_SECRET') ?? secret();
  createEnv(bffEnv, { ...hostApps.bff, WS_TOKEN_SECRET: wsTokenSecret });

  const internalApiSecret = secret();
  const created = createEnv(realtimeEnv, {
    ...hostApps.realtime,
    WS_TOKEN_SECRET: wsTokenSecret,
    INTERNAL_API_SECRET: internalApiSecret,
  });
  if (!created) return;
  if (!usesUserSecrets(stack)) {
    log.log(
      `setup:env left the user secrets alone (stack ${stack.name}): \`eval "$(pnpm --silent dev:env)"\` gives the backend the INTERNAL_API_SECRET of ${shown(realtimeEnv)}`,
    );
    return;
  }
  // The realtime service signs with this secret and the backend verifies it, so the backend gets the same value.
  if (storeUserSecret(root, internalApiSecret)) {
    log.log('setup:env stored INTERNAL_API_SECRET in the business backend user secrets');
  } else {
    log.warn(
      'setup:env could not store INTERNAL_API_SECRET for the business backend (is the .NET SDK installed?).\n' +
        `Set it yourself to the value in ${shown(realtimeEnv)}: dotnet user-secrets set INTERNAL_API_SECRET <value> --project ${BACKEND_PROJECT}`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  setupDevEnv({ root, stack: currentStack(root) });
}
