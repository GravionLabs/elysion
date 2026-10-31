import { type Page, expect, test } from '@playwright/test';
import { USER_A, expectAccessible, login } from './helpers.js';

/**
 * Personal access tokens and integrations (#851, ADR 0033). A person makes a token on "Access tokens" (the secret is shown once),
 * a script uses it on the public API (`/public/v1/me`) and is refused on the browser's API, the list shows its last use, an
 * administrator sees it, and after the person revokes it the public API refuses it. The example integration of the dev realm gets a
 * token from Keycloak with the client-credentials grant and is accepted on the public API only.
 */
test.describe.configure({ mode: 'serial' });

const ADMIN = 'dev';
const NAME = `E2E token ${Date.now()}`;
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost';
const KEYCLOAK = process.env.E2E_KEYCLOAK_URL ?? 'http://localhost:8081';

let person: Page;
let admin: Page;
let secret: string;

const call = (path: string, token: string) =>
  fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${token}` } });

test.beforeAll(async ({ browser }) => {
  person = await login(browser, USER_A);
  admin = await login(browser, ADMIN);
});

test.afterAll(async () => {
  // A token left by a test that failed half way: revoke it, so nothing usable stays behind.
  if (person) {
    await person.goto('/settings/tokens');
    const revoke = person.getByRole('button', { name: `Revoke ${NAME}`, exact: true });
    if (await revoke.count()) {
      await revoke.click();
      await person.getByRole('dialog').getByRole('button', { name: 'Revoke', exact: true }).click();
      await expect(revoke).toHaveCount(0);
    }
  }
  await person?.context().close();
  await admin?.context().close();
});

test('a person makes a token in the settings and sees its secret once', async () => {
  await person.getByRole('button', { name: USER_A, exact: true }).click();
  await person.getByRole('menuitem', { name: 'Access tokens' }).click();
  await expect(person).toHaveURL(/\/settings\/tokens$/);
  await expect(person.getByRole('heading', { name: 'Access tokens', level: 1 })).toBeVisible();

  await person.getByRole('textbox', { name: 'Name', exact: true }).fill(NAME);
  await person.getByRole('checkbox', { name: /boards:write/ }).check();
  await person.getByLabel('Expires after').selectOption('7');
  await person.getByRole('button', { name: 'Create token' }).click();

  const field = person.getByLabel('New access token');
  await expect(field).toHaveValue(/^elp_[0-9A-Za-z]{43}$/);
  secret = await field.inputValue();
  await expect(person.getByText(/shown only this once/)).toBeVisible();
  const row = person.getByRole('row', { name: new RegExp(NAME) });
  await expect(row).toContainText(`${secret.slice(0, 12)}…`);
  await expect(row).toContainText('boards:read');
  await expect(row).toContainText('boards:write');
  await expect(row).toContainText('never');
  await expectAccessible(person, 'the access tokens page with a new secret');

  await person.getByRole('button', { name: 'I have copied it' }).click();
  await expect(person.getByLabel('New access token')).toHaveCount(0);
  await person.reload();
  await expect(person.getByRole('row', { name: new RegExp(NAME) })).toBeVisible();
  await expect(person.getByText(secret)).toHaveCount(0);
});

test('a script uses the token on the public API, and the browser API refuses it', async () => {
  const me = await call('/public/v1/me', secret);
  expect(me.status).toBe(200);
  const body = (await me.json()) as { kind: string; scopes: string[]; tokenId: string | null };
  expect(body.kind).toBe('person');
  expect(body.scopes).toEqual(['boards:read', 'boards:write']);
  expect(body.tokenId).not.toBeNull();

  expect((await call('/api/boards', secret)).status).toBe(401);

  // The list shows when it was used.
  await person.reload();
  await expect(person.getByRole('row', { name: new RegExp(NAME) })).not.toContainText('never');
});

test('an administrator sees the token with its owner', async () => {
  await admin.goto('/admin/tokens');
  await admin.getByRole('searchbox', { name: 'Search access tokens' }).fill(NAME);
  await admin.getByRole('button', { name: 'Search', exact: true }).click();

  const row = admin.getByRole('row', { name: new RegExp(NAME) });
  await expect(row).toContainText(USER_A);
  await expect(row).toContainText(`${secret.slice(0, 12)}…`);
  await expectAccessible(admin, 'the administration of access tokens');
});

test('the person revokes the token, and the public API refuses it', async () => {
  await person
    .getByRole('row', { name: new RegExp(NAME) })
    .getByRole('button', { name: `Revoke ${NAME}` })
    .click();
  await person.getByRole('dialog').getByRole('button', { name: 'Revoke', exact: true }).click();
  await expect(person.getByRole('row', { name: new RegExp(NAME) })).toHaveCount(0);

  expect((await call('/public/v1/me', secret)).status).toBe(401);

  await admin.reload();
  await admin.getByRole('searchbox', { name: 'Search access tokens' }).fill(NAME);
  await admin.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(admin.getByRole('row', { name: new RegExp(NAME) })).toContainText('revoked');
});

test('the example integration is accepted on the public API only', async () => {
  const answer = await fetch(`${KEYCLOAK}/realms/elysion/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: 'elysion-integration-example',
      client_secret: 'elysion-integration-example-dev-secret',
      scope: 'boards:read',
    }),
  });
  // A Keycloak database imported before #851 has no such client: drop the `keycloak` database (apps/e2e/AGENTS.md).
  test.skip(answer.status === 401, 'the realm has no example integration (imported before #851)');
  expect(answer.status).toBe(200);
  const token = ((await answer.json()) as { access_token: string }).access_token;

  const me = await call('/public/v1/me', token);
  expect(me.status).toBe(200);
  expect(await me.json()).toMatchObject({
    kind: 'integration',
    name: 'elysion-integration-example',
    tokenId: null,
    scopes: ['boards:read'],
  });
  expect((await call('/api/boards', token)).status).toBe(403);

  // The administration lists it among the integrations.
  await admin.goto('/admin/users');
  await admin.getByRole('combobox', { name: 'Show' }).selectOption('integration');
  await expect(
    admin
      .getByRole('row', { name: /elysion-integration-example/ })
      .getByText('Integration', { exact: true }),
  ).toBeVisible();
});
