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
 * Following and presenting (#848), with two people on one board: A presents and pans, B's view follows; B steps out with
 * Esc and stays where it is; "Bring everyone to me" moves B once. The canvas is drawn on a `<canvas>`, so the view is read
 * from the dots of the grid, which the canvas lays out from the scroll and zoom (`--grid-offset-*`, `--grid-spacing`).
 */
test.describe.configure({ mode: 'serial' });

const BOARD = 'E2E presenting';

let a: Page;
let b: Page;

test.beforeAll(async ({ browser }) => {
  a = await login(browser, USER_A);
  b = await login(browser, USER_B);
});

test.afterAll(async () => {
  if (a) {
    await openBoardList(a);
    await deleteBoardsNamed(a, BOARD);
  }
  await a?.context().close();
  await b?.context().close();
});

/** Where the dots of the grid are: the same for two windows of one size that show the same part of the board. */
const view = (page: Page) =>
  page.locator('.elysion-canvas').evaluate((root) => {
    const style = getComputedStyle(root);
    return ['--grid-spacing', '--grid-offset-x', '--grid-offset-y']
      .map((name) => style.getPropertyValue(name).trim())
      .join(' ');
  });

/** Pans the canvas of a page the way a person does, with the wheel over the board. */
async function pan(page: Page, deltaY: number): Promise<void> {
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, deltaY);
  await page.waitForTimeout(400);
}

const menuItem = async (page: Page, name: string) => {
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await page.getByRole('menuitem', { name }).click();
};

test('a board shared with a second person, who is on it', async () => {
  await openBoardList(a);
  const url = await createBoard(a, BOARD);
  await a.getByRole('button', { name: /^Share/ }).click();
  await a.getByRole('combobox', { name: 'Person' }).fill(emailOf(USER_B));
  await a.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(a.getByText(emailOf(USER_B))).toBeVisible();
  await a.keyboard.press('Escape');

  await openBoard(b, url);
  // The avatars are buttons: "Follow <name>".
  await expect(a.getByRole('button', { name: `Follow ${USER_B}` })).toBeVisible();
  await expect(b.getByRole('button', { name: `Follow ${USER_A}` })).toBeVisible();
});

test('B follows A by a click on the avatar, and stops with Esc', async () => {
  await b.getByRole('button', { name: `Follow ${USER_A}` }).click();
  await expect(b.getByRole('status').filter({ hasText: 'Following' })).toHaveText(
    `Following ${USER_A} — Esc to stop`,
  );

  await pan(a, 300);
  await expect.poll(() => view(b)).toBe(await view(a));

  await b.keyboard.press('Escape');
  await expect(b.getByRole('status').filter({ hasText: 'Following' })).toHaveCount(0);
  const stayed = await view(b);
  await pan(a, 300);
  expect(await view(b)).toBe(stayed);
});

test('A presents, B follows without asking, steps out and comes back', async () => {
  await menuItem(a, 'Start presenting');
  await expect(a.getByRole('status').filter({ hasText: 'You are presenting' })).toBeVisible();
  await expect(b.getByRole('status').filter({ hasText: 'Following' })).toHaveText(
    `Following ${USER_A} — Esc to stop`,
  );

  await pan(a, 400);
  await expect.poll(() => view(b)).toBe(await view(a));

  await b.keyboard.press('Escape');
  await expect(b.getByRole('button', { name: 'Follow presenter' })).toBeVisible();
  const stayed = await view(b);
  await pan(a, 300);
  expect(await view(b)).toBe(stayed);

  await b.getByRole('button', { name: 'Follow presenter' }).click();
  await expect.poll(() => view(b)).toBe(await view(a));
});

test('A ends the presentation: nobody follows any more', async () => {
  await menuItem(a, 'Stop presenting');

  await expect(b.getByRole('status').filter({ hasText: 'Following' })).toHaveCount(0);
  await expect(b.getByRole('button', { name: 'Follow presenter' })).toHaveCount(0);
  const stayed = await view(b);
  await pan(a, 300);
  expect(await view(b)).toBe(stayed);
});

test('"Bring everyone to me" moves B once, without following', async () => {
  await pan(a, 500);
  await menuItem(a, 'Bring everyone to me');

  await expect.poll(() => view(b)).toBe(await view(a));
  await expect(b.getByRole('status').filter({ hasText: 'Following' })).toHaveCount(0);
  const stayed = await view(b);
  await pan(a, 300);
  expect(await view(b)).toBe(stayed);
});
