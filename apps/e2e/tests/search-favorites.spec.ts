import { type Page, expect, test } from '@playwright/test';
import {
  USER_A,
  boardCard,
  createBoard,
  deleteBoardsNamed,
  login,
  openBoard,
  openBoardList,
} from './helpers.js';

/**
 * Finding boards (#730): the search narrows the list by name and lives in the address (`?q=`), the order is remembered, a star puts
 * a board in Favorites and at the top of All boards, and opening a board makes it the "last opened" one.
 */
test.describe.configure({ mode: 'serial' });

const FIRST = 'E2E find alpha';
const SECOND = 'E2E find beta';

let page: Page;
let secondUrl: string;

test.beforeAll(async ({ browser }) => {
  page = await login(browser, USER_A);
  await openBoardList(page);
  await createBoard(page, FIRST);
  await openBoardList(page);
  secondUrl = await createBoard(page, SECOND);
  await openBoardList(page);
});

test.afterAll(async () => {
  if (page) {
    await openBoardList(page);
    await deleteBoardsNamed(page, FIRST);
    await deleteBoardsNamed(page, SECOND);
  }
  await page?.context().close();
});

test('the search narrows the list, and the address keeps it', async () => {
  await page.keyboard.press('/');
  await expect(page.getByRole('searchbox', { name: 'Search boards' })).toBeFocused();

  await page.keyboard.type('e2e find b');

  await expect(boardCard(page, SECOND)).toBeVisible();
  await expect(boardCard(page, FIRST)).toHaveCount(0);
  await expect(page).toHaveURL(/[?&]q=e2e(%20|\+)find(%20|\+)b/);

  await page.reload();
  await expect(page.getByRole('searchbox', { name: 'Search boards' })).toHaveValue('e2e find b');
  await expect(boardCard(page, FIRST)).toHaveCount(0);

  await page.getByRole('button', { name: 'Clear the search' }).click();
  await expect(boardCard(page, FIRST)).toBeVisible();
});

test('a star puts a board into Favorites and first in All boards', async () => {
  await page
    .getByRole('button', { name: `Add the board ${FIRST} to the favorites` })
    .click({ force: true });
  await expect(
    page.getByRole('button', { name: `Remove the board ${FIRST} from the favorites` }),
  ).toBeVisible();

  await page.reload();
  await expect(page.locator('.board-name').first()).toHaveText(FIRST);

  await page.getByRole('link', { name: /^Favorites/ }).click();
  await expect(page.getByRole('heading', { name: 'Favorites' })).toBeVisible();
  await expect(boardCard(page, FIRST)).toBeVisible();
  await expect(boardCard(page, SECOND)).toHaveCount(0);
});

test('the order "Last opened" follows what was opened, and is remembered', async () => {
  await openBoard(page, secondUrl);
  await openBoardList(page);
  // A starred board is first whatever the order, so the star goes first.
  await page
    .getByRole('button', { name: `Remove the board ${FIRST} from the favorites` })
    .click({ force: true });

  await page.getByLabel('Sort by').selectOption('opened');
  await expect(page.locator('.board-name').first()).toHaveText(SECOND);

  await page.reload();
  await expect(page.getByLabel('Sort by')).toHaveValue('opened');
});
