import { defineConfig } from '@playwright/test';

/**
 * Browser tests of the running stack (`docker compose up -d`, or `pnpm dev:stack`). They are not part of `pnpm test`.
 *
 * - `E2E_BASE_URL`: where the stack is (default http://localhost).
 * - `E2E_USER_A` / `E2E_USER_B`: two demo users (default dev1 and dev2; the password is the username). A Keycloak
 *   database that was imported before dev1 and dev2 existed has only `dev` and `guest`.
 * - `E2E_CHROME_PATH`: a browser to use instead of Playwright's own (`pnpm exec playwright install chromium`).
 */
export default defineConfig({
  testDir: './tests',
  // The tests of one file share one board and run in order; files do not share anything.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.E2E_CHROME_PATH
      ? { executablePath: process.env.E2E_CHROME_PATH, args: ['--no-sandbox'] }
      : {},
  },
});
