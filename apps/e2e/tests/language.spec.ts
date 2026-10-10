import { expect, test } from '@playwright/test';
import { USER_A, login } from './helpers.js';

/**
 * Languages (#738): the app is served in the language the browser asks for, and the user menu switches it for good
 * (a cookie nginx reads; the URL is not localized).
 */
test('the app opens in German for a browser that asks for German, and the switch is remembered', async ({
  browser,
}) => {
  const page = await login(browser, USER_A, {
    locale: 'de-DE',
    extraHTTPHeaders: { 'Accept-Language': 'de-DE,de;q=0.9,en;q=0.5' },
  });
  try {
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.getByRole('button', { name: 'Neues Board', exact: true })).toBeVisible();

    // The user menu switches to English; the choice outlives the browser's own preference.
    await page.getByRole('button', { name: USER_A, exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'English' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('button', { name: 'New board', exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('button', { name: 'New board', exact: true })).toBeVisible();
  } finally {
    await page.context().close();
  }
});

test('the app opens in English for a browser that does not ask for German', async ({ browser }) => {
  const page = await login(browser, USER_A, { locale: 'fr-FR' });
  try {
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('button', { name: 'New board', exact: true })).toBeVisible();
  } finally {
    await page.context().close();
  }
});
