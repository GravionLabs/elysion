import { type Page, expect, test } from '@playwright/test';
import {
  USER_A,
  USER_B,
  createBoard,
  deleteBoardsNamed,
  emailOf,
  login,
  openBoard,
  openBoardList,
} from './helpers.js';

/**
 * A person who is removed from a board loses the board they have open (#772). The WS token proves a role for a minute
 * and the socket lives for hours, so the realtime service asks the business backend again every 15 seconds and closes
 * the socket of somebody who has no role any more; the canvas then asks for a new token, is refused, and says so.
 */
test.describe.configure({ mode: 'serial' });

const BOARD = 'E2E membership';

let a: Page;
let b: Page;
let boardUrl: string;

test.beforeAll(async ({ browser }) => {
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
  if (a) {
    await openBoardList(a);
    await deleteBoardsNamed(a, BOARD);
  }
  await a?.context().close();
  await b?.context().close();
});

test('a person who is removed while the board is open is disconnected and told so', async () => {
  await expect(b.getByText('Connected', { exact: true })).toBeVisible();

  await a.getByRole('button', { name: /^Share/ }).click();
  await a.getByRole('button', { name: new RegExp(`^Remove ${USER_B}`) }).click();
  await expect(a.getByText(emailOf(USER_B))).toHaveCount(0);
  await a.keyboard.press('Escape');

  // The realtime service rechecks every 15 s; the reconnect then gets a 403 for its new token.
  await expect(b.getByText('You no longer have access to this board.')).toBeVisible({
    timeout: 60_000,
  });
  await expect(b.getByText('Connected', { exact: true })).toHaveCount(0);
});
