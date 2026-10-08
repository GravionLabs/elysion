import { type Browser, type Page, expect } from '@playwright/test';

export const USER_A = process.env.E2E_USER_A ?? 'dev1';
export const USER_B = process.env.E2E_USER_B ?? 'dev2';

/** The demo users' e-mail addresses follow their names (infra/keycloak/realm-elysion.json). */
export const emailOf = (user: string) => `${user}@elysion.local`;

/** Logs a demo user in through Keycloak (the password is the username) in a browser context of its own. */
export async function login(browser: Browser, user: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.fill('#username', user);
  await page.fill('#password', user);
  await page.click('#kc-login');
  await expect(page.getByRole('button', { name: user, exact: true })).toBeVisible();
  return page;
}

/** Opens a board and waits until the realtime connection is up. */
export async function openBoard(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  // The canvas draws its first frame and the view settles.
  await page.waitForTimeout(1500);
}
