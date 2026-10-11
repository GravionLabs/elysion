import { expect, test } from '@playwright/test';
import { failOnCspViolation } from './helpers.js';

/**
 * The shell can send people straight to the company's login (`AUTH_IDP_HINT`, #644): with an `idpHint` in `/auth-config.json` the
 * login starts with `kc_idp_hint=microsoft` and Keycloak forwards to the stand-in of Entra ID at once, so its own login page,
 * with the "Microsoft" button, is never shown. The stack here runs without the hint (the default), so the settings are answered
 * with one in this test.
 */
test('with an idpHint the login goes straight to the company login', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  failOnCspViolation(page);
  await page.route('**/auth-config.json', async (route) => {
    const response = await route.fetch();
    const settings = (await response.json()) as Record<string, string>;
    await route.fulfill({ response, json: { ...settings, idpHint: 'microsoft' } });
  });

  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/');

  // The stand-in's own page asks for the user name: Keycloak's page with the Microsoft button never came up.
  await expect(page).toHaveURL(/\/realms\/entra-stub\//);
  await expect(page.locator('#username')).toBeVisible();
  expect(requests.some((url) => url.includes('kc_idp_hint=microsoft'))).toBe(true);
  await context.close();
});

test('without an idpHint the settings carry an empty one and the login shows Keycloak’s page', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const settings = await page.request.get('/auth-config.json');
  expect(await settings.json()).toMatchObject({ idpHint: '' });

  await page.goto('/');
  await expect(page.locator('#social-microsoft')).toBeVisible();
  await context.close();
});
