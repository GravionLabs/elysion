import { type Page, expect, test } from '@playwright/test';
import {
  USER_A,
  USER_B,
  boardElements,
  canUseCompose,
  compose,
  createBoard,
  deleteBoardsNamed,
  elementCount,
  emailOf,
  login,
  openBoard,
  waitForApi,
  openBoardList,
} from './helpers.js';

/**
 * Losing and regaining the connection (#718): the realtime service is stopped while two people are on a board; the
 * top bar says "Offline", the person who draws during the outage keeps what was drawn, and when the service is back
 * the status returns and the other person has everything. A second run with a WS token of 5 seconds shows that a token
 * that has run out neither ends an open connection nor stops a reconnect.
 *
 * It stops a container of the stack the tests run against, so it is skipped where that is not allowed (`E2E_NO_COMPOSE`).
 * (`docker compose stop` and not `pause`: a frozen process keeps its TCP connections open and the browser would not
 * notice anything.)
 */
test.describe.configure({ mode: 'serial' });
test.skip(!canUseCompose, 'E2E_NO_COMPOSE is set: the stack is not ours to stop');

const BOARD = 'E2E reconnect';

let a: Page;
let b: Page;
let boardUrl: string;

async function drawRectangle(page: Page, x: number, y: number) {
  const box = (await page.locator('elysion-canvas').boundingBox())!;
  await page.getByTestId('elysion-tool-rectangle').click();
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + 60, box.y + y + 40, { steps: 5 });
  await page.mouse.up();
}

async function bothSee(expected: number) {
  await expect.poll(() => elementCount(a), { timeout: 60_000 }).toBe(expected);
  await expect.poll(() => elementCount(b), { timeout: 60_000 }).toBe(expected);
}

/** Stops the realtime service, lets `during` run while it is down, and starts it again. */
async function outage(during: () => Promise<void>) {
  await compose(['stop', 'realtime']);
  try {
    await expect(a.getByText('Offline', { exact: true })).toBeVisible({ timeout: 30_000 });
    await during();
  } finally {
    await compose(['start', 'realtime']);
  }
  await expect(a.getByText('Connected', { exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(b.getByText('Connected', { exact: true })).toBeVisible({ timeout: 90_000 });
}

test.beforeAll(async ({ browser }) => {
  // A WS token that lives for 5 seconds (the BFF is the only one that reads it).
  await compose(['up', '-d', '--no-deps', 'bff'], { WS_TOKEN_TTL_SECONDS: '5' });
  await waitForApi();
  a = await login(browser, USER_A);
  b = await login(browser, USER_B);
  await openBoardList(a);
  boardUrl = await createBoard(a, BOARD);
  await a.getByRole('button', { name: /^Share/ }).click();
  await a.getByPlaceholder('name@example.com').fill(emailOf(USER_B));
  await a.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(a.getByText(emailOf(USER_B))).toBeVisible();
  await a.keyboard.press('Escape');
  await openBoard(b, boardUrl);
});

test.afterAll(async () => {
  await compose(['start', 'realtime']).catch(() => undefined);
  await compose(['up', '-d', '--no-deps', 'bff']).catch(() => undefined); // back to the normal token lifetime
  await waitForApi().catch(() => undefined);
  if (a) {
    await openBoardList(a);
    await deleteBoardsNamed(a, BOARD);
  }
  await a?.context().close();
  await b?.context().close();
});

test('what one person draws during an outage reaches the other when the service is back', async () => {
  await drawRectangle(a, 320, 150);
  await bothSee(1);

  await outage(async () => {
    await expect(b.getByText('Offline', { exact: true })).toBeVisible({ timeout: 30_000 });
    await drawRectangle(a, 320, 350);
    await drawRectangle(a, 520, 350);
    expect(await elementCount(a)).toBe(3);
    expect(await elementCount(b)).toBe(1);
  });

  await bothSee(3);
});

test('a token that has run out ends neither an open connection nor a reconnect', async () => {
  // The token of this connection is past its 5 seconds: the connection stays up and keeps carrying changes.
  await a.waitForTimeout(8_000);
  await expect(a.getByText('Connected', { exact: true })).toBeVisible();
  await drawRectangle(a, 720, 150);
  await bothSee(4);

  await outage(async () => {
    await a.waitForTimeout(8_000); // longer than a token lives
  });

  await bothSee(4);
  await drawRectangle(b, 720, 350);
  await bothSee(5);
  expect((await boardElements(a)).length).toBe(5);
  await expect(a.getByRole('alert')).toHaveCount(0);
});
