import { type Page, expect, test } from '@playwright/test';
import {
  USER_A,
  USER_B,
  createBoard,
  deleteBoardsNamed,
  emailOf,
  expectAccessible,
  login,
  openBoardList,
} from './helpers.js';

/**
 * The audit log (#669). The owner (dev1) gives dev2 a role on a board and sees it in the History of the Share dialog; the
 * administrator (`dev`) finds the same entry in the Audit page, filters by the board and reads it as a sentence. A person who is
 * not an administrator has no Audit page.
 */
test.describe.configure({ mode: 'serial' });

const ADMIN = 'dev';
const BOARD = 'E2E audit board';

let owner: Page;
let admin: Page;

test.beforeAll(async ({ browser }) => {
  owner = await login(browser, USER_A);
  admin = await login(browser, ADMIN);
  await openBoardList(owner);
  await createBoard(owner, BOARD);
});

test.afterAll(async () => {
  if (owner) {
    await openBoardList(owner);
    await deleteBoardsNamed(owner, BOARD);
  }
  await owner?.context().close();
  await admin?.context().close();
});

test('the owner sees who got a role in the history of the Share dialog', async () => {
  await owner.getByRole('button', { name: /^Share/ }).click();
  await owner.getByRole('combobox', { name: 'Person' }).fill(emailOf(USER_B));
  await owner.getByLabel('Role of the new member').selectOption('Viewer');
  await owner.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(owner.getByText(emailOf(USER_B))).toBeVisible();

  await owner.getByRole('button', { name: /^History/ }).click();

  const history = owner.getByRole('region', { name: 'History' });
  await expect(
    history.getByText(new RegExp(`${USER_A} gave ${USER_B} the role Viewer`)),
  ).toBeVisible();
  await expectAccessible(owner, 'the history of the Share dialog');
});

test('the administrator finds the entry in the audit log and filters by the board', async () => {
  await admin.goto('/admin/audit');
  await expect(admin.getByRole('heading', { name: 'Audit' })).toBeVisible();

  await admin
    .getByRole('button', { name: `Board: ${BOARD}` })
    .first()
    .click();
  await expect(admin.getByRole('listitem').filter({ hasText: `About: ${BOARD}` })).toBeVisible();
  await expect(
    admin.getByRole('cell', { name: new RegExp(`${USER_A} gave ${USER_B} the role Viewer`) }),
  ).toBeVisible();
  await expectAccessible(admin, 'the audit page');

  await admin.getByRole('button', { name: /^Remove the filter About/ }).click();
  await expect(admin.getByRole('listitem').filter({ hasText: 'About:' })).toHaveCount(0);
});

test('a person who is not an administrator has no audit page', async () => {
  await owner.goto('/admin/audit');
  await expect(owner.getByRole('heading', { name: 'You are not an administrator' })).toBeVisible();
});
