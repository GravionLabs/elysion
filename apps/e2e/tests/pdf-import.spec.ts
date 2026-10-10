import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Page, expect, test } from '@playwright/test';
import {
  USER_A,
  USER_B,
  boardElements,
  createBoard,
  deleteBoardsNamed,
  emailOf,
  login,
  openBoard,
  openBoardList,
} from './helpers.js';

/**
 * Bringing a PDF onto the board (#725): the pages are rendered in the browser (pdf.js in a worker, no server involved), shown as
 * thumbnails to choose from, and each becomes a picture in a frame named after its page, in one undo step. The other person sees
 * the pages. A violation of the Content-Security-Policy fails the test (`failOnCspViolation`), which is what holds pdf.js to it.
 */
test.describe.configure({ mode: 'serial' });

const BOARD = 'E2E pdf import';
const FIXTURE = fileURLToPath(new URL('../fixtures/two-pages.pdf', import.meta.url));

let a: Page;
let b: Page;
let boardUrl: string;

const frames = async (page: Page) => (await boardElements(page)).filter((e) => e.type === 'frame');
const images = async (page: Page) => (await boardElements(page)).filter((e) => e.type === 'image');
const live = async (page: Page) =>
  (await boardElements(page)).filter((e) => !(e as { isDeleted?: boolean }).isDeleted);

test.beforeAll(async ({ browser }) => {
  a = await login(browser, USER_A);
  b = await login(browser, USER_B);
  await openBoardList(a);
  boardUrl = await createBoard(a, BOARD);
  await a.getByRole('button', { name: /^Share/ }).click();
  await a.getByPlaceholder('name@example.com').fill(emailOf(USER_B));
  await a.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(a.getByText(emailOf(USER_B))).toBeVisible();
  await a.keyboard.press('Escape');
  await openBoard(a, boardUrl);
  await openBoard(b, boardUrl);
});

test.afterAll(async () => {
  if (a) {
    await openBoardList(a);
    await deleteBoardsNamed(a, BOARD);
  }
  await a?.context().close();
  await b?.context().close();
});

test('the pages of a PDF are shown to choose from, and each chosen page becomes a picture in a frame', async () => {
  const uploads: string[] = [];
  a.on('request', (request) => {
    if (request.method() === 'PUT' && /\/api\/boards\/[^/]+\/files\//.test(request.url())) {
      uploads.push(request.headers()['content-type'] ?? '');
    }
  });

  await a.locator('input[type=file]').setInputFiles(FIXTURE);
  const dialog = a.getByRole('dialog', { name: /two-pages\.pdf/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('checkbox')).toHaveCount(2);
  await expect(dialog.locator('img')).toHaveCount(2, { timeout: 30_000 }); // both thumbnails drawn
  await dialog.getByRole('button', { name: 'Import 2 pages' }).click();

  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(async () => (await frames(a)).length).toBe(2);
  expect((await images(a)).length).toBe(2);
  const names = (await frames(a)).map((frame) => (frame as { name?: string }).name).sort();
  expect(names).toEqual(['Page 1', 'Page 2']);
  for (const image of await images(a)) {
    expect((image as { frameId?: string }).frameId).toBeTruthy();
  }
  await expect.poll(async () => (await frames(b)).length).toBe(2);
  await expect.poll(async () => (await images(b)).length).toBe(2);
  expect(uploads).toEqual(['image/png', 'image/png']);
});

test('one undo takes all the pages off the board again', async () => {
  await a.getByRole('button', { name: 'Undo' }).click();

  await expect.poll(async () => (await live(a)).length).toBe(0);
  await expect.poll(async () => (await live(b)).length).toBe(0);
});

test('a page can be left out: only the chosen one comes', async () => {
  await a.locator('input[type=file]').setInputFiles(FIXTURE);
  const dialog = a.getByRole('dialog', { name: /two-pages\.pdf/ });
  await expect(dialog.getByRole('checkbox')).toHaveCount(2);
  await dialog.getByRole('checkbox').first().uncheck();
  await dialog.getByRole('button', { name: 'Import 1 page' }).click();

  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(async () => (await live(a)).filter((e) => e.type === 'frame').length).toBe(1);
  expect(
    ((await frames(a)).find((e) => !(e as { isDeleted?: boolean }).isDeleted) as { name?: string })
      .name,
  ).toBe('Page 2');
});

test('canceling the dialog adds nothing', async () => {
  const before = (await live(a)).length;
  await a.locator('input[type=file]').setInputFiles(FIXTURE);
  const dialog = a.getByRole('dialog', { name: /two-pages\.pdf/ });
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await expect(dialog).toHaveCount(0);
  expect((await live(a)).length).toBe(before);
});

test('a PDF dropped on the board opens the same dialog', async () => {
  const bytes = readFileSync(FIXTURE).toString('base64');
  await a.evaluate((base64) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], 'dropped.pdf', {
        type: 'application/pdf',
      }),
    );
    (document.elementFromPoint(640, 400) ?? document.body).dispatchEvent(
      new DragEvent('drop', {
        dataTransfer: transfer,
        clientX: 640,
        clientY: 400,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, bytes);

  const dialog = a.getByRole('dialog', { name: /dropped\.pdf/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});

test('a file that is no PDF is refused with a message', async () => {
  await a.locator('input[type=file]').setInputFiles({
    name: 'broken.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('this is not a pdf'),
  });

  await expect(
    a.getByRole('status').filter({ hasText: 'broken.pdf could not be read as a PDF' }),
  ).toBeVisible({ timeout: 30_000 });
});
