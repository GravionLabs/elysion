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

  it('keeps every client of the development realm except the example ones, and every role and mapper', () => {
    assert.deepEqual(
      production.clients.map((c) => c.clientId),
      ['elysion-frontend', 'elysion-bff'],
    );
    assert.deepEqual(production.roles, dev.roles);
    assert.deepEqual(production.clients[0].protocolMappers, dev.clients[0].protocolMappers);
  });

  it('keeps Microsoft Entra ID switched off unless the operator switches it on, with no development address or secret', () => {
    const provider = production.identityProviders.find((p) => p.alias === 'microsoft');
    assert.equal(provider.enabled, '${ENTRA_ENABLED:false}');
    assert.match(provider.config.clientSecret, /^\$\{ENTRA_CLIENT_SECRET:/);
    assert.doesNotMatch(JSON.stringify(provider), /localhost|keycloak:8080|dev-secret/);
    assert.deepEqual(production.identityProviderMappers, dev.identityProviderMappers);
  });

  it('limits a session to 8 hours, the window of a change in the directory (ADR 0027)', () => {
    assert.equal(production.ssoSessionMaxLifespan, 28800);
  });

  it('leaves out the example integration client, which is demo-only and shares no secret with the BFF', () => {
    assert.ok(dev.clients.some((c) => c.clientId === 'elysion-integration-example'));
    assert.equal(
      production.clients.find((c) => c.clientId === 'elysion-integration-example'),
      undefined,
    );
    assert.doesNotMatch(text, /integration-example/);
  });

  it('drops any client whose clientId ends in -example and keeps one that only contains it', () => {
    const realm = {
      clients: [
        { clientId: 'acme-example' },
        { clientId: 'example-sync' },
        { clientId: 'elysion-bff', secret: 'x' },
      ],
    };
    assert.deepEqual(
      buildProductionRealm(realm).clients.map((c) => c.clientId),
      ['example-sync', 'elysion-bff'],
    );
  });

  it('does not change the development realm', () => {
    assert.ok(dev.users.length > 0);
    assert.ok(dev.clients.some((c) => c.clientId === 'elysion-integration-example'));
    assert.equal(dev.sslRequired, 'none');
  });
});
