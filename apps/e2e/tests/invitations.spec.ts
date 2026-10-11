import { type Page, expect, test } from '@playwright/test';
import {
  USER_A,
  USER_B,
  createBoard,
  deleteBoardsNamed,
  expectAccessible,
  login,
  openBoardList,
} from './helpers.js';

/**
 * Invitation links (#734): the owner makes a link for a Viewer, the second person opens it and ends up on the board without
 * having been added by email, the owner sees the use and revokes the link, and the revoked link says so. The token is taken
 * out of the address and shown only once, when the link is made.
 */
test.describe.configure({ mode: 'serial' });

const BOARD = 'E2E invitations';

let a: Page;
let b: Page;
let link: string;

const dialog = (page: Page) => page.getByRole('dialog', { name: /^Share/ });

test.beforeAll(async ({ browser }) => {
  a = await login(browser, USER_A);
  b = await login(browser, USER_B);
  await openBoardList(a);
  await createBoard(a, BOARD);
  await a.getByRole('button', { name: /^Share/ }).click();
  await expect(dialog(a)).toBeVisible();
});

test.afterAll(async () => {
  if (a) {
    await openBoardList(a);
    await deleteBoardsNamed(a, BOARD);
  }
  await a?.context().close();
  await b?.context().close();
});

test('the owner makes a link for a Viewer, shown once', async () => {
  await expect(dialog(a).getByText('No active links')).toBeVisible();
  await dialog(a).locator('.invite-links select').first().selectOption('Viewer');
  await dialog(a).getByRole('button', { name: 'Create link' }).click();

  const field = dialog(a).getByLabel('New link');
  await expect(field).toHaveValue(/\/invite\/[A-Za-z0-9_-]{20,}$/);
  link = await field.inputValue();
  await expect(dialog(a).getByText(/shown only now/)).toBeVisible();
  await expect(dialog(a).getByRole('list', { name: 'Active links' })).toContainText('Viewer');
  await expectAccessible(a, 'the share dialog with an invitation link');
});

test('the second person opens the link and is on the board as a viewer', async () => {
  await b.goto(link);

  await expect(b).toHaveURL(/\/board\/[0-9a-f-]+$/);
  await expect(b.getByText('Connected', { exact: true })).toBeVisible();
  // The token is not in the address any more, nor in the history one step back.
  expect(b.url()).not.toContain('invite');
  await expect(b.getByRole('button', { name: /^Timer/ })).toHaveCount(0);
  await expect(b.getByRole('button', { name: /^Share/ })).toHaveCount(0);
});

test('the owner sees the use and revokes the link', async () => {
  await a.keyboard.press('Escape');
  await a.getByRole('button', { name: /^Share/ }).click();
  const list = dialog(a).getByRole('list', { name: 'Active links' });
  await expect(list).toContainText('used 1');

  await list.getByRole('button', { name: /^Revoke/ }).click();
  await expect(dialog(a).getByText('No active links')).toBeVisible();
});

test('a revoked link says so', async () => {
  await b.goto(link);

  await expect(b.getByRole('heading', { name: /does not work any more/ })).toBeVisible();
  await expect(b.getByRole('link', { name: 'Go to your boards' })).toBeVisible();
  expect(b.url()).not.toContain('invite/');
  await expectAccessible(b, 'the page of a link that does not work');
});
