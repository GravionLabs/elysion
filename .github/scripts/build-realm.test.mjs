import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { APP_URL, BFF_SECRET, buildProductionRealm } from '../../scripts/build-realm.mjs';

const dev = JSON.parse(
  readFileSync(new URL('../../infra/keycloak/realm-elysion.json', import.meta.url), 'utf8'),
);
const production = buildProductionRealm(dev);
const text = JSON.stringify(production);

describe('the production realm', () => {
  it('has no users and no direct password grant, and requires TLS for external requests', () => {
    assert.equal(production.users, undefined);
    assert.equal(production.sslRequired, 'external');
    for (const client of production.clients) assert.equal(client.directAccessGrantsEnabled, false);
  });

  it('has no development address and no development secret', () => {
    assert.doesNotMatch(text, /localhost/);
    assert.doesNotMatch(text, /dev-secret|dev-only|elysion123/);
  });

  it('takes the address of the application and the BFF secret from the environment', () => {
    const frontend = production.clients.find((c) => c.clientId === 'elysion-frontend');
    assert.deepEqual(frontend.redirectUris, [`${APP_URL}/*`]);
    assert.deepEqual(frontend.webOrigins, [APP_URL]);
    assert.equal(frontend.attributes['post.logout.redirect.uris'], `${APP_URL}/*`);
    assert.equal(production.clients.find((c) => c.clientId === 'elysion-bff').secret, BFF_SECRET);
  });

  it('keeps every client, role and mapper of the development realm', () => {
    assert.deepEqual(
      production.clients.map((c) => c.clientId),
      dev.clients.map((c) => c.clientId),
    );
    assert.deepEqual(production.roles, dev.roles);
    assert.deepEqual(production.clients[0].protocolMappers, dev.clients[0].protocolMappers);
  });

  it('does not change the development realm', () => {
    assert.ok(dev.users.length > 0);
    assert.equal(dev.sslRequired, 'none');
  });
});
