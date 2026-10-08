// `pnpm setup:env` (also run by `pnpm dev:infra`, so the VS Code "Elysion: full stack" launch has it): creates the
// git-ignored `.env` files of the BFF and the realtime service from their `.env.example`, with fresh random secrets
// instead of the example values. It never touches a file that exists, so running it again changes nothing.
//
// - WS_TOKEN_SECRET is shared by the BFF and the realtime service (a new one, or the BFF's if its `.env` exists).
// - INTERNAL_API_SECRET is shared by the realtime service and the business backend (ADR 0017). The backend reads it
//   from .NET user secrets (the `UserSecretsId` of its project), which win over `appsettings.Development.json`.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bffEnv = join(root, 'apps/bff/.env');
const realtimeEnv = join(root, 'apps/realtime/.env');
const backendProject = join(
  root,
  'apps/business-backend/src/Elysion.BusinessBackend.Api/Elysion.BusinessBackend.Api.csproj',
);

const secret = () => randomBytes(32).toString('base64url'); // 43 characters, the services want at least 32
const shown = (path) => relative(root, path).replaceAll('\\', '/');

function readSetting(file, name) {
  if (!existsSync(file)) return undefined;
  return readFileSync(file, 'utf8')
    .match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]
    .trim();
}

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
  console.log(
    `setup:env created ${shown(file)} (${Object.keys(values).join(', ') || 'as in the example'})`,
  );
  return true;
}

const wsTokenSecret = readSetting(bffEnv, 'WS_TOKEN_SECRET') ?? secret();
createEnv(bffEnv, { WS_TOKEN_SECRET: wsTokenSecret });

const internalApiSecret = secret();
if (
  createEnv(realtimeEnv, { WS_TOKEN_SECRET: wsTokenSecret, INTERNAL_API_SECRET: internalApiSecret })
) {
  // The realtime service signs with this secret and the backend verifies it, so the backend gets the same value.
  const result = spawnSync(
    'dotnet',
    ['user-secrets', 'set', 'INTERNAL_API_SECRET', internalApiSecret, '--project', backendProject],
    { encoding: 'utf8' },
  );
  if (result.status === 0) {
    console.log('setup:env stored INTERNAL_API_SECRET in the business backend user secrets');
  } else {
    console.warn(
      'setup:env could not store INTERNAL_API_SECRET for the business backend (is the .NET SDK installed?).\n' +
        `Set it yourself to the value in ${shown(realtimeEnv)}: dotnet user-secrets set INTERNAL_API_SECRET <value> --project ${shown(backendProject)}`,
    );
  }
}
