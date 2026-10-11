import { type Page, expect, test } from '@playwright/test';
import {
  USER_A,
  createBoard,
  deleteBoardsNamed,
  boardElements,
  login,
  openBoardList,
} from './helpers.js';

/**
 * A board holds at most 20,000 live elements (ADR 0026, #701). The canvas takes the limit from its `max-elements`
 * attribute, so this test sets it to 3 instead of drawing 20,000 elements: the fourth rectangle is not added, the
 * person is told,.
 */
const BOARD = 'E2E limits';

let a: Page;

async function drawRectangle(page: Page, x: number, y: number) {
  const box = (await page.locator('elysion-canvas').boundingBox())!;
  await page.getByTestId('elysion-tool-rectangle').click();
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + 60, box.y + y + 40, { steps: 5 });
  await page.mouse.up();
}

test.beforeAll(async ({ browser }) => {
  a = await login(browser, USER_A);
  await openBoardList(a);
  await createBoard(a, BOARD);
  await expect(a.getByText('Connected', { exact: true })).toBeVisible();
});

test.afterAll(async () => {
  if (a) {
    await openBoardList(a);
    await deleteBoardsNamed(a, BOARD);
  }
  await a?.context().close();
});

test('an element that would take the board over its limit is not added, and the person is told', async () => {
  await a
    .locator('elysion-canvas')
    .evaluate((element) => element.setAttribute('max-elements', '3'));

  for (const [x, y] of [
    [300, 150],
    [450, 150],
    [600, 150],
    [750, 150],
  ]) {
    await drawRectangle(a, x, y);
  }

  await expect(a.getByRole('status').filter({ hasText: 'This board is full' })).toBeVisible();
  const live = async () =>
    (await boardElements(a)).filter((element) => !(element as { isDeleted?: boolean }).isDeleted)
      .length;
  await expect.poll(live).toBe(3);
});
