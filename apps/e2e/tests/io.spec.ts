import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Download, type Page, expect, test } from '@playwright/test';
import {
  USER_A,
  boardElements,
  createBoard,
  deleteBoardsNamed,
  elementCount,
  login,
  openBoardList,
} from './helpers.js';

/**
 * Import and export (#716): an `.excalidraw` fixture replaces the board's content; the board is exported as PNG, SVG,
 * PDF and Excalidraw file (each a real download with a plausible content), and only the selection when asked to.
 */
test.describe.configure({ mode: 'serial' });

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'sample.excalidraw',
);
const BOARD = 'E2E import and export';

let a: Page;
let fixtureIds: string[];

/** Opens the export menu, picks the item and returns the download it starts. */
async function exportAs(page: Page, item: string, selectionOnly = false): Promise<Download> {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Export' });
  if (selectionOnly) await menu.getByLabel('Selection only').check();
  const download = page.waitForEvent('download');
  await menu.getByRole('menuitem', { name: item }).click();
  return download;
}

async function bytesOf(download: Download): Promise<Buffer> {
  const path = await download.path();
  return readFile(path);
}

test.beforeAll(async ({ browser }) => {
  fixtureIds = (
    JSON.parse(await readFile(FIXTURE, 'utf8')) as {
      elements: { id: string; isDeleted?: boolean }[];
    }
  ).elements
    .filter((element) => !element.isDeleted)
    .map((element) => element.id);
  a = await login(browser, USER_A);
  await openBoardList(a);
  await createBoard(a, BOARD);
});

test.afterAll(async () => {
  if (a) {
    await openBoardList(a);
    await deleteBoardsNamed(a, BOARD);
  }
  await a?.context().close();
});

test('an .excalidraw file replaces the board after a confirmation', async () => {
  expect(await elementCount(a)).toBe(0);

  await a.locator('input[type="file"]').setInputFiles(FIXTURE);
  const confirm = a.getByRole('alertdialog', { name: 'Confirm import' });
  await expect(confirm).toContainText('sample.excalidraw');
  await confirm.getByRole('button', { name: 'Replace' }).click();

  await expect.poll(() => elementCount(a)).toBe(fixtureIds.length);
  expect((await boardElements(a)).map((element) => element.id).sort()).toEqual(
    [...fixtureIds].sort(),
  );
});

test('the board is exported as a PNG image', async () => {
  const download = await exportAs(a, 'PNG image');
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const bytes = await bytesOf(download);
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(bytes.length).toBeGreaterThan(5_000);
});

test('the board is exported as an SVG image', async () => {
  const download = await exportAs(a, 'SVG image');
  expect(download.suggestedFilename()).toMatch(/\.svg$/);
  const text = (await bytesOf(download)).toString('utf8');
  expect(text).toContain('<svg');
  expect(text.length).toBeGreaterThan(5_000);
});

test('the board is exported as a PDF document', async () => {
  const download = await exportAs(a, 'PDF document');
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const bytes = await bytesOf(download);
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(bytes.length).toBeGreaterThan(1_000);
});

test('the board is exported as an Excalidraw file that holds its elements', async () => {
  const download = await exportAs(a, 'Excalidraw file');
  expect(download.suggestedFilename()).toMatch(/\.excalidraw$/);
  const file = JSON.parse((await bytesOf(download)).toString('utf8')) as {
    type: string;
    elements: { id: string }[];
  };
  expect(file.type).toBe('excalidraw');
  expect(file.elements.map((element) => element.id).sort()).toEqual([...fixtureIds].sort());
});

test('only the selection is exported when asked to', async () => {
  // Select one element through the canvas' keyboard: Ctrl+A selects all, so click one shape of the fixture instead.
  await a.keyboard.press('Control+a');
  const all = await exportAs(a, 'Excalidraw file');
  const everything = JSON.parse((await bytesOf(all)).toString('utf8')).elements.length;

  // Escape clears the selection; a click on the first element of the view selects one.
  await a.keyboard.press('Escape');
  const box = await a.locator('elysion-canvas').boundingBox();
  expect(box).not.toBeNull();
  await a.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

  const selected = await exportAs(a, 'Excalidraw file', true);
  const some = JSON.parse((await bytesOf(selected)).toString('utf8')).elements.length;
  expect(everything).toBe(fixtureIds.length);
  expect(some).toBeGreaterThan(0);
  expect(some).toBeLessThan(everything);
});
