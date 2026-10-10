import { type Page, expect, test } from '@playwright/test';
import {
  USER_A,
  USER_B,
  boardCard,
  createBoard,
  deleteBoardsNamed,
  emailOf,
  login,
  openBoard,
  openBoardList,
} from './helpers.js';

/**
 * The picture on a board's card (#729): when an editor leaves a board the canvas renders it (480 by 300, light theme) and it is
 * stored; the overview shows it instead of the initials. A viewer never makes one. The picture is fetched with the person's
 * token (an `<img src>` could not send it) and shown from an object URL.
 */
test.describe.configure({ mode: 'serial' });

const BOARD = 'E2E thumbnail';

let a: Page;
let b: Page;
let boardUrl: string;

const isThumbnailPut = (request: { method(): string; url(): string }) =>
  request.method() === 'PUT' && /\/api\/boards\/[^/]+\/thumbnail$/.test(request.url());

test.beforeAll(async ({ browser }) => {
  a = await login(browser, USER_A);
  b = await login(browser, USER_B);
  await openBoardList(a);
  boardUrl = await createBoard(a, BOARD);
  await a.getByRole('button', { name: /^Share/ }).click();
  await a.getByPlaceholder('name@example.com').fill(emailOf(USER_B));
  await a.getByLabel('Role of the new member').selectOption('Viewer');
  await a.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(a.getByText(emailOf(USER_B))).toBeVisible();
  await a.keyboard.press('Escape');
  await openBoard(a, boardUrl);
});

test.afterAll(async () => {
  if (a) {
    await openBoardList(a);
    await deleteBoardsNamed(a, BOARD);
  }
  await a?.context().close();
  await b?.context().close();
});

test('an editor who leaves a drawn board makes the picture of its card', async () => {
  const box = (await a.locator('elysion-canvas').boundingBox())!;
  await a.getByTestId('elysion-tool-rectangle').click();
  await a.mouse.move(box.x + 300, box.y + 200);
  await a.mouse.down();
  await a.mouse.move(box.x + 520, box.y + 330, { steps: 6 });
  await a.mouse.up();
  await a.waitForTimeout(500);

  const stored = a.waitForResponse((r) => isThumbnailPut(r.request()));
  const shown = a.waitForResponse(
    (r) => r.request().method() === 'GET' && /\/api\/boards\/[^/]+\/thumbnail/.test(r.url()),
  );
  await a.getByRole('link', { name: 'Elysion: all boards' }).click();

  expect((await stored).status()).toBe(204);
  const answer = await shown;
  expect(answer.status()).toBe(200);
  expect(answer.headers()['content-type']).toBe('image/png');
  // The board as it looks (a rectangle on its color), not an empty frame: more than a blank 480 by 300 PNG weighs.
  expect((await answer.body()).length).toBeGreaterThan(1_500);
  const picture = boardCard(a, BOARD).locator('app-board-thumbnail img');
  await expect(picture).toBeVisible();
  const size = await picture.evaluate((image: HTMLImageElement) => ({
    width: image.naturalWidth,
    height: image.naturalHeight,
  }));
  expect(size).toEqual({ width: 480, height: 300 });
});

test('a viewer who leaves the board makes no picture', async () => {
  await openBoard(b, boardUrl);
  const puts: string[] = [];
  b.on('request', (request) => {
    if (isThumbnailPut(request)) puts.push(request.url());
  });

  await b.getByRole('link', { name: 'Elysion: all boards' }).click();
  await expect(boardCard(b, BOARD)).toBeVisible();
  await b.waitForTimeout(1500);

  expect(puts).toEqual([]);
});
