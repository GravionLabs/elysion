import { type Page, expect, test } from '@playwright/test';
import {
  boardCard,
  createBoard,
  deleteBoardsNamed,
  loginThroughMicrosoft,
  openBoardList,
} from './helpers.js';

/**
 * Signing in through the company's identity (ADR 0027): the realm `elysion` brokers to the stand-in realm `entra-stub`, which plays
 * Microsoft Entra ID. `erika` is a person the stand-in knows; Keycloak makes a user of the realm `elysion` for her on the first login
 * and finds that user again on the next one (it is linked, not made twice).
 */
test.describe.configure({ mode: 'serial' });

const PERSON = 'erika';
const BOARD = 'E2E single sign-on';

let page: Page;

test.afterAll(async () => {
  await page?.context().close();
});

test('a person signs in through Microsoft, makes a board and signs out', async ({ browser }) => {
  page = await loginThroughMicrosoft(browser, PERSON);
  await openBoardList(page);
  await createBoard(page, BOARD);
  await openBoardList(page);
  await expect(boardCard(page, BOARD)).toBeVisible();

  await page.getByRole('button', { name: PERSON, exact: true }).click();
  await page.getByRole('menuitem', { name: /Log out/ }).click();
  await expect(page.locator('#social-microsoft')).toBeVisible();
});

test('the next sign-in finds the same person and her board', async ({ browser }) => {
  await page.context().close();
  page = await loginThroughMicrosoft(browser, PERSON);
  await openBoardList(page);
  await expect(boardCard(page, BOARD)).toBeVisible();
  await deleteBoardsNamed(page, BOARD);
});
