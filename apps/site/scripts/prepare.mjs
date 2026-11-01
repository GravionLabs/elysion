// Puts the project icon and the public API's OpenAPI document (docs/api/openapi.v1.json, a download on the reference page) where
// the site serves them from. The icon has one source, apps/frontend/public/icon.svg (the
// favicon and the app icon); `apps/site/public` is git-ignored and made again before every build.
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(resolve(root, 'public'), { recursive: true });
cpSync(resolve(root, '../frontend/public/icon.svg'), resolve(root, 'public/icon.svg'));
mkdirSync(resolve(root, 'public/api'), { recursive: true });
cpSync(
  resolve(root, '../../docs/api/openapi.v1.json'),
  resolve(root, 'public/api/openapi.v1.json'),
);
