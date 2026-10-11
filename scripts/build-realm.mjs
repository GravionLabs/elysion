// The production realm, derived from the development realm (ADR 0028): `infra/keycloak/realm-elysion.json` is the one source of truth
// and this removes what only the demo needs. Two files edited by hand would diverge the first time somebody adds a client.
//
//   node scripts/build-realm.mjs [out-file]     (default: stdout; CI writes realm-elysion.production.json and attaches it to the release)
//
// The result has no users, no direct password grant, `sslRequired: external`, and Keycloak `${VAR}` placeholders (substituted from the
// environment at import) for the address of the application and the secret of the BFF's client:
//   ELYSION_APP_URL             https://elysion.example   (no trailing slash)
//   ELYSION_BFF_CLIENT_SECRET   a long random string, also what the BFF is configured with

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const APP_URL = '${ELYSION_APP_URL}';
export const BFF_SECRET = '${ELYSION_BFF_CLIENT_SECRET}';

/** @param {Record<string, any>} realm the parsed development realm */
export function buildProductionRealm(realm) {
  const production = structuredClone(realm);
  delete production.users;
  production.sslRequired = 'external';
  production.clients = production.clients.map((client) => {
    const next = { ...client, directAccessGrantsEnabled: false };
    if (client.publicClient) {
      next.redirectUris = [`${APP_URL}/*`];
      next.webOrigins = [APP_URL];
      if (client.attributes?.['post.logout.redirect.uris'] !== undefined) {
        next.attributes = {
          ...client.attributes,
          'post.logout.redirect.uris': `${APP_URL}/*`,
        };
      }
    }
    if (client.secret !== undefined) next.secret = BFF_SECRET;
    return next;
  });
  return production;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const source = new URL('../infra/keycloak/realm-elysion.json', import.meta.url);
  const json = `${JSON.stringify(buildProductionRealm(JSON.parse(readFileSync(source, 'utf8'))), null, 2)}\n`;
  if (process.argv[2]) writeFileSync(process.argv[2], json);
  else process.stdout.write(json);
}
