import { type Page, expect, test } from '@playwright/test';
import {
  USER_A,
  USER_B,
  boardElements,
  createBoard,
  deleteBoardsNamed,
  elementCount,
  emailOf,
  login,
  openBoard,
  openBoardList,
} from './helpers.js';

/**
 * A sticky note in the dark theme (#737): the document keeps the stored, light colors that everybody shares, the person in the dark
 * theme sees the dark palette's yellow (not the muddy shade the canvas filter makes of the pale paper), and the other person, in
 * the light theme, sees the stored paper. The canvas is a `<canvas>`, so the colors are read from its pixels.
 */
test.describe.configure({ mode: 'serial' });

const BOARD = 'E2E dark sticky';
/** The stored paper of the yellow note (tint of --c-node-amber, light theme). */
const STORED_PAPER = '#f3d577';
/** What the yellow paper looks like on the dark canvas: a deep shade of the dark palette's amber (sticky-dark.ts). */
const DARK_PAPER = '#5f4e09';

let a: Page;
let b: Page;
let boardUrl: string;

/** The color of a pixel inside the note, left of its text, as it is drawn on the page. */
async function paperPixel(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas.static') as HTMLCanvasElement;
    const box = canvas.getBoundingClientRect();
    const scale = canvas.width / box.width;
    // The note is made in the middle of the view: 200 by 160 scene units, so a point 60 left and 50 above the middle is paper.
    const zoomed = 1;
    const x = Math.round((box.width / 2 - 60 * zoomed) * scale);
    const y = Math.round((box.height / 2 - 50 * zoomed) * scale);
    const [red, green, blue] = canvas.getContext('2d')!.getImageData(x, y, 1, 1).data;
    return `#${[red, green, blue].map((value) => value!.toString(16).padStart(2, '0')).join('')}`;
  });
}

const distance = (first: string, second: string) =>
  Math.max(
    ...[1, 3, 5].map((i) =>
      Math.abs(parseInt(first.slice(i, i + 2), 16) - parseInt(second.slice(i, i + 2), 16)),
    ),
  );

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

test('a yellow note drawn in the dark theme shows the dark palette, and the other person sees the stored paper', async () => {
  await a
    .getByRole('button', { name: /dark|Dark/ })
    .first()
    .click();
  await expect(a.locator('elysion-canvas')).toHaveAttribute('theme', 'dark');

  await a.getByTestId('elysion-tool-sticky').click();
  await expect.poll(() => elementCount(a)).toBe(2); // the note is a rectangle and its text
  await expect.poll(() => elementCount(b)).toBe(2);

  // A, in the dark theme: the yellow of the dark palette.
  await expect
    .poll(async () => distance(await paperPixel(a), DARK_PAPER), { timeout: 10_000 })
    .toBeLessThanOrEqual(14);
  // B, in the light theme: the stored paper.
  await expect
    .poll(async () => distance(await paperPixel(b), STORED_PAPER), { timeout: 10_000 })
    .toBeLessThanOrEqual(8);
});

test('the document keeps the light colors, for the person in the dark theme as well', async () => {
  const [note] = (await boardElements(a)).filter((element) => element.type === 'rectangle');
  expect(note!.backgroundColor).toBe(STORED_PAPER);
  const [theirs] = (await boardElements(b)).filter((element) => element.type === 'rectangle');
  expect(theirs!.backgroundColor).toBe(STORED_PAPER);
});

test('switching back to the light theme shows the stored paper again', async () => {
  await a
    .getByRole('button', { name: /light|Light/ })
    .first()
    .click();
  await expect(a.locator('elysion-canvas')).toHaveAttribute('theme', 'light');

  await expect
    .poll(async () => distance(await paperPixel(a), STORED_PAPER), { timeout: 10_000 })
    .toBeLessThanOrEqual(8);
  const [note] = (await boardElements(a)).filter((element) => element.type === 'rectangle');
  expect(note!.backgroundColor).toBe(STORED_PAPER);
});
