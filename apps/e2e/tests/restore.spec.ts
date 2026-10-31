import { type Page, expect, test } from '@playwright/test';
import {
  USER_A,
  USER_B,
  createBoard,
  deleteBoardsNamed,
  elementCount,
  emailOf,
  login,
  openBoard,
  openBoardList,
} from './helpers.js';

/**
 * Restoring a version (#847, ADR 0032), with two people on one board: A (the owner) saves a version, draws more, and
 * restores the version; both end up on the restored state without reloading, B is told who restored it, and the state before
 * the restore is a version of its own. B (an editor) opens the version as a new board.
 */
test.describe.configure({ mode: 'serial' });

const BOARD = 'E2E restore';
const COPY = `${BOARD} (Good state)`;

let a: Page;
let b: Page;
let boardUrl: string;

/** Draws a rectangle with the mouse, as a person does. */
async function rectangle(page: Page, at: [number, number]) {
  await page.getByTestId('elysion-tool-rectangle').click();
  await page.mouse.move(...at);
  await page.mouse.down();
  await page.mouse.move(at[0] + 60, at[1] + 40, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
}

const history = (page: Page) => page.getByRole('complementary', { name: 'History' });

test.beforeAll(async ({ browser }) => {
  a = await login(browser, USER_A);
  b = await login(browser, USER_B);
  await openBoardList(a);
  boardUrl = await createBoard(a, BOARD);
  await a.getByRole('button', { name: /^Share/ }).click();
  await a.getByRole('combobox', { name: 'Person' }).fill(emailOf(USER_B));
  await a.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(a.getByText(emailOf(USER_B))).toBeVisible();
  await a.keyboard.press('Escape');
  await openBoard(b, boardUrl);
});

test.afterAll(async () => {
  if (a) {
    await openBoardList(a);
    await deleteBoardsNamed(a, COPY);
    await deleteBoardsNamed(a, BOARD);
  }
  await b?.context().close();
  await a?.context().close();
});

test('A saves a version with one rectangle and draws a second one; B sees both', async () => {
  await rectangle(a, [500, 300]);
  await expect.poll(() => elementCount(b)).toBe(1);

  await a.keyboard.press('Alt+h');
  await expect(history(a)).toBeVisible();
  await a.getByRole('button', { name: 'Save version' }).click();
  await a.getByRole('textbox', { name: 'Version name (optional)' }).fill('Good state');
  await a.keyboard.press('Enter');
  await expect(history(a).getByText('Good state')).toBeVisible();
  await a.keyboard.press('Escape');

  await rectangle(a, [700, 300]);
  await expect.poll(() => elementCount(a)).toBe(2);
  await expect.poll(() => elementCount(b)).toBe(2);
});

test('only the owner may restore: B sees "Open as new board" but no Restore', async () => {
  await b.keyboard.press('Alt+h');
  await expect(history(b)).toBeVisible();
  await expect(
    history(b).getByRole('button', { name: 'Open Good state as new board' }),
  ).toBeVisible();
  await expect(history(b).getByRole('button', { name: /^Restore/ })).toHaveCount(0);
  await b.keyboard.press('Escape');
});

test('A restores the version: both have one rectangle again, B is told, nobody reloaded', async () => {
  await a.keyboard.press('Alt+h');
  await a.getByRole('button', { name: 'Restore Good state' }).click();
  await a.getByRole('button', { name: 'Restore version' }).click();
  await expect(history(a).getByText(/The version is restored\./)).toBeVisible();
  // The state before the restore is kept and is a version to restore as well.
  await expect(history(a).getByText('Before restore').first()).toBeVisible();
  await a.keyboard.press('Escape');

  await expect.poll(() => elementCount(a)).toBe(1);
  await expect.poll(() => elementCount(b)).toBe(1);
  await expect(b.locator('.board-banner')).toContainText(`${USER_A} restored the version of`);
  await expect(b.getByText('Connected', { exact: true })).toBeVisible();
});

test('A goes back by restoring "Before restore": both have two rectangles again', async () => {
  await a.keyboard.press('Alt+h');
  await a.getByRole('button', { name: 'Restore Before restore' }).first().click();
  await a.getByRole('button', { name: 'Restore version' }).click();
  await expect(history(a).getByText(/The version is restored\./)).toBeVisible();
  await a.keyboard.press('Escape');

  await expect.poll(() => elementCount(a)).toBe(2);
  await expect.poll(() => elementCount(b)).toBe(2);
});

test('B opens the version as a new board with one rectangle; the old board keeps two', async () => {
  await b.keyboard.press('Alt+h');
  await b.getByRole('button', { name: 'Open Good state as new board' }).click();

  await expect(b).toHaveURL(/\/board\/[0-9a-f-]+$/);
  expect(b.url()).not.toBe(boardUrl);
  await expect(b.getByText('Connected', { exact: true })).toBeVisible();
  await expect.poll(() => elementCount(b)).toBe(1);
  await expect.poll(() => elementCount(a)).toBe(2);

  // B owns the copy; clean it up so that nothing stays on the stack.
  await openBoardList(b);
  await expect(b.getByText(COPY, { exact: true }).first()).toBeVisible();
  await deleteBoardsNamed(b, COPY);
});
