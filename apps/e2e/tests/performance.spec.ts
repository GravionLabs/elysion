import { expect, test } from '@playwright/test';
import { USER_A, login } from './helpers.js';

/**
 * The first load (#710): the board list is a lazy chunk of a small shell and does not wait for the canvas bundle (the heavy
 * part, `/canvas/elysion-canvas.js`, which only the board page loads). Measured on Chrome's "Fast 3G" profile with a cold
 * cache; the limit is the one of the issue, 2.5 s for the Largest Contentful Paint of the list.
 */
const FAST_3G = {
  offline: false,
  latency: 150,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
};
const LCP_LIMIT_MS = 2500;

test('the board list paints on Fast 3G without loading the canvas bundle', async ({ browser }) => {
  test.setTimeout(90_000);
  const page = await login(browser, USER_A);
  const client = await page.context().newCDPSession(page);
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', FAST_3G);
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));

  // The session cookie of the identity provider is there, so this goes through the login and back without a form.
  await page.goto('/');
  await expect(page.getByRole('button', { name: /New board/ }).first()).toBeVisible({
    timeout: 30_000,
  });
  const lcp = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          resolve(entries[entries.length - 1]!.startTime);
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      }),
  );
  console.log(`LCP of the board list on Fast 3G: ${Math.round(lcp)} ms`);

  expect(lcp).toBeLessThan(LCP_LIMIT_MS);
  expect(requested.filter((url) => url.includes('/canvas/'))).toEqual([]);
  await page.context().close();
});
