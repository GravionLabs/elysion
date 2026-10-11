import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Page, expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import {
  USER_A,
  boardCard,
  createBoard,
  deleteBoardsNamed,
  elementCount,
  login,
  openBoardList,
} from './helpers.js';

/**
 * Exporting a room as one PDF (#727): every board of the room is opened in a hidden canvas, one after another, and becomes a title
 * page and its own pages (one per frame, #726); an empty board is a title page alone. The page count is read with `pdf-lib`.
 */
test.describe.configure({ mode: 'serial' });

const ROOM = 'E2E room export';
const WITH_FRAMES = 'E2E export two frames';
const EMPTY = 'E2E export empty';
const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'two-frames.excalidraw',
);

let a: Page;
let roomPath: string;

const roomLink = (page: Page) =>
  page.getByRole('navigation', { name: 'Rooms' }).getByRole('link', { name: new RegExp(ROOM) });

test.beforeAll(async ({ browser }) => {
  a = await login(browser, USER_A);
  await openBoardList(a);
  await a.getByRole('button', { name: '+ New room' }).click();
  await a.getByRole('textbox', { name: 'Room name' }).fill(ROOM);
  await a.getByRole('button', { name: 'Create', exact: true }).click();
  await roomLink(a).click();
  await expect(a.getByRole('heading', { name: ROOM })).toBeVisible();
  roomPath = new URL(a.url()).pathname;

  await createBoard(a, WITH_FRAMES);
  await a.locator('input[type="file"]').setInputFiles(FIXTURE);
  await a
    .getByRole('alertdialog', { name: 'Confirm import' })
    .getByRole('button', { name: 'Replace' })
    .click();
  await expect.poll(() => elementCount(a)).toBe(4);
  await a.waitForTimeout(1500); // the board is saved a moment after the last change
  await openBoardList(a, roomPath);
  await createBoard(a, EMPTY);
  await openBoardList(a, roomPath);
});

test.afterAll(async () => {
  if (a) {
    await openBoardList(a);
    if (await roomLink(a).count()) {
      await roomLink(a).click();
      await a.getByRole('button', { name: 'Delete room' }).click();
      await a.getByRole('alertdialog').getByRole('button', { name: 'Delete room' }).click();
      await expect(roomLink(a)).toHaveCount(0);
    }
    await openBoardList(a);
    for (const name of [WITH_FRAMES, EMPTY]) await deleteBoardsNamed(a, name);
  }
  await a?.context().close();
});

test('a room becomes one PDF: a title page per board and the pages of each board', async () => {
  await expect(boardCard(a, WITH_FRAMES)).toBeVisible();
  const download = a.waitForEvent('download', { timeout: 90_000 });

  await a.getByRole('button', { name: 'Export room' }).click();
  const file = await download;

  expect(file.suggestedFilename()).toMatch(/E2E-room-export.*\.pdf$/);
  const pdf = await PDFDocument.load(await readFile(await file.path()));
  // The board with two frames: its title page and two pages; the empty board: its title page.
  expect(pdf.getPageCount()).toBe(1 + 2 + 1);
});

test('the progress can be canceled: nothing is downloaded', async () => {
  let downloads = 0;
  a.on('download', () => (downloads += 1));

  await a.getByRole('button', { name: 'Export room' }).click();
  const dialog = a.getByRole('dialog', { name: 'Exporting the room' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await expect(dialog).toHaveCount(0);
  await a.waitForTimeout(3000);
  expect(downloads).toBe(0);
});
