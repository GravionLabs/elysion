import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Download, type Page, expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import {
  USER_A,
  createBoard,
  deleteBoardsNamed,
  elementCount,
  login,
  openBoardList,
} from './helpers.js';

/**
 * The PDF export of a board with frames (#726): one page per frame in the order of the frames' names, the options of the Export
 * menu (page size, orientation) and that the last choice is remembered. The page count and the sizes are read with `pdf-lib`.
 */
test.describe.configure({ mode: 'serial' });

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'two-frames.excalidraw',
);
const BOARD = 'E2E pdf export';

let a: Page;

async function openMenu(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  return page.getByRole('menu', { name: 'Export' });
}

async function exportPdf(page: Page): Promise<PDFDocument> {
  const menu = await openMenu(page);
  const download = page.waitForEvent('download');
  await menu.getByRole('menuitem', { name: 'PDF document' }).click();
  const path = await ((await download) as Download).path();
  return PDFDocument.load(await readFile(path));
}

test.beforeAll(async ({ browser }) => {
  a = await login(browser, USER_A);
  await openBoardList(a);
  await createBoard(a, BOARD);
  await a.locator('input[type="file"]').setInputFiles(FIXTURE);
  await a
    .getByRole('alertdialog', { name: 'Confirm import' })
    .getByRole('button', { name: 'Replace' })
    .click();
  await expect.poll(() => elementCount(a)).toBe(4);
});

test.afterAll(async () => {
  if (a) {
    await openBoardList(a);
    await deleteBoardsNamed(a, BOARD);
  }
  await a?.context().close();
});

test('a board with two frames exports a PDF with two pages, one per frame', async () => {
  const pdf = await exportPdf(a);

  expect(pdf.getPageCount()).toBe(2);
});

test('the whole board on one page when that is chosen', async () => {
  await openMenu(a);
  await a.getByLabel('PDF pages').selectOption('whole');
  await a.keyboard.press('Escape');

  const pdf = await exportPdf(a);

  expect(pdf.getPageCount()).toBe(1);
});

test('A4 in landscape, and the choices are still there after a reload', async () => {
  await openMenu(a);
  await a.getByLabel('PDF pages').selectOption('auto');
  await a.getByLabel('Page size').selectOption('a4');
  await a.getByLabel('Orientation').selectOption('landscape');
  await a.keyboard.press('Escape');

  const pdf = await exportPdf(a);

  expect(pdf.getPageCount()).toBe(2);
  const { width, height } = pdf.getPage(0).getSize();
  expect(width).toBeCloseTo(841.89, 0); // A4 turned: 297 mm wide, in points
  expect(height).toBeCloseTo(595.28, 0);

  await a.reload();
  await expect(a.getByText('Connected', { exact: true })).toBeVisible();
  await openMenu(a);
  await expect(a.getByLabel('Page size')).toHaveValue('a4');
  await expect(a.getByLabel('Orientation')).toHaveValue('landscape');
});
