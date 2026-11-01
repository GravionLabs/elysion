import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Download, type Page, expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
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
 * The agenda of a workshop (#849), with two people on one board. A brings in a board whose file carries an agenda with two
 * items, each linked to a frame far from the other; "Start" on the first runs the shared timer and moves B to its frame, "Next"
 * moves both on, and B sees the current item in its own agenda panel. Then the board is saved as a template and a board made
 * from it has the agenda as a plan, and a PDF can start with the agenda. The view is read from the grid dots, as in
 * presenting.spec.ts.
 */
test.describe.configure({ mode: 'serial' });

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'agenda.excalidraw',
);
const BOARD = 'E2E agenda';
const FROM_TEMPLATE = 'E2E agenda from template';
const TEMPLATE = 'E2E agenda template';

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
    await deleteBoardsNamed(a, FROM_TEMPLATE);
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

/** Opens the agenda panel from the canvas menu (Facilitation, Agenda). */
async function openAgenda(page: Page) {
  await page.getByRole('button', { name: 'Canvas menu' }).click();
  await page.getByRole('menuitem', { name: /Agenda/ }).click();
  const panel = page.getByRole('complementary', { name: 'Agenda' });
  await expect(panel).toBeVisible();
  return panel;
}

const countdown = /0[0-9]:\d\d/;

test('a board whose file carries an agenda, shared with a second person', async () => {
  await openBoardList(a);
  const url = await createBoard(a, BOARD);
  await a.getByRole('button', { name: /^Share/ }).click();
  await a.getByRole('combobox', { name: 'Person' }).fill(emailOf(USER_B));
  await a.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(a.getByText(emailOf(USER_B))).toBeVisible();
  await a.keyboard.press('Escape');

  await a.locator('input[type="file"]').setInputFiles(FIXTURE);
  await a
    .getByRole('alertdialog', { name: 'Confirm import' })
    .getByRole('button', { name: 'Replace' })
    .click();
  await expect.poll(() => elementCount(a)).toBe(2);
  // The notice of the import takes room from the canvas: both windows must show the board at the same size.
  await a.getByRole('button', { name: 'Dismiss' }).click();
  await openBoard(b, url);

  const panel = await openAgenda(a);
  await expect(panel.getByRole('listitem')).toHaveCount(2);
  await expect(panel.getByText('Frame: Warm-up')).toBeVisible();
  await expect(panel.getByText('Total: 13 min', { exact: false })).toBeVisible();
});

test('A starts an item: B sees the timer and is moved to its frame, without following', async () => {
  await pan(b, 600);
  const before = await view(b);

  await a.getByRole('button', { name: 'Start Warm-up' }).click();

  await expect(a.locator('app-top-bar')).toContainText(countdown);
  await expect(b.locator('app-top-bar')).toContainText(countdown);
  await expect.poll(() => view(b)).toBe(await view(a));
  expect(await view(b)).not.toBe(before);
  await expect(b.getByRole('status').filter({ hasText: 'Following' })).toHaveCount(0);

  // B sees the current item highlighted and announced in its own panel.
  const panel = await openAgenda(b);
  await expect(panel.getByRole('status')).toHaveText('Now: Warm-up');
  await expect(panel.locator('li[aria-current="step"]')).toContainText('Warm-up');
  await expect(panel.getByRole('button', { name: 'Next' })).toBeVisible();
});

test('"Next" finishes the item and brings both to the next frame', async () => {
  const atWarmUp = await view(a);
  await a.getByRole('button', { name: 'Next', exact: true }).click();

  await expect.poll(() => view(a)).not.toBe(atWarmUp);
  await expect.poll(() => view(b)).toBe(await view(a));
  const panel = b.getByRole('complementary', { name: 'Agenda' });
  await expect(panel.getByRole('status')).toHaveText('Now: Ideas');
  await expect(panel.locator('li').first()).toContainText('Done');
  await expect(panel.locator('li').first()).toContainText(/\d+:\d\d spent/);
});

test('a PDF can start with the agenda', async () => {
  await a.getByRole('button', { name: 'Export', exact: true }).click();
  const menu = a.getByRole('menu', { name: 'Export' });
  await a.getByRole('checkbox', { name: 'Agenda as the first page of a PDF' }).check();
  const download = a.waitForEvent('download');
  await menu.getByRole('menuitem', { name: 'PDF document' }).click();
  const pdf = await PDFDocument.load(await readFile(await ((await download) as Download).path()));
  expect(pdf.getPageCount()).toBe(3); // the agenda, then one page per frame
});

test('the agenda comes with the template into a new board, as a plan with nothing run', async () => {
  await a.getByRole('button', { name: 'Templates', exact: true }).click();
  await a
    .getByRole('menu', { name: 'Templates' })
    .getByRole('menuitem', { name: 'Save board as template…' })
    .click();
  const form = a.getByRole('form', { name: 'Save as template' });
  await form.getByRole('textbox', { name: 'Template name' }).fill(TEMPLATE);
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form).toHaveCount(0);

  await openBoardList(a);
  await createBoard(a, FROM_TEMPLATE, TEMPLATE);
  await expect.poll(() => elementCount(a), { timeout: 20_000 }).toBe(2);
  const panel = await openAgenda(a);
  await expect(panel.getByRole('listitem')).toHaveCount(2);
  await expect(panel.getByText('Frame: Warm-up')).toBeVisible();
  await expect(panel.locator('li[aria-current="step"]')).toHaveCount(0);
  await expect(panel.getByText('Done')).toHaveCount(0);

  // The own template goes again.
  await a.getByRole('button', { name: 'Templates', exact: true }).click();
  const templates = a.getByRole('menu', { name: 'Templates' });
  await a.getByRole('button', { name: `Delete the template ${TEMPLATE}` }).click();
  await templates.getByRole('menuitem', { name: `Delete “${TEMPLATE}”?` }).click();
  await expect(templates.getByRole('menuitem', { name: new RegExp(`^${TEMPLATE}`) })).toHaveCount(
    0,
  );
});
