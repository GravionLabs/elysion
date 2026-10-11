import { type Page, expect, test } from '@playwright/test';
import { USER_A, USER_B, emailOf, login, openBoard } from './helpers.js';
import { makePng } from './png.js';

/**
 * Images on a board (#702): the bytes live in the object store, the shared document holds a reference. One person
 * inserts a PNG, the other sees it, and it survives a reload. The canvas is drawn on a `<canvas>`, so what is
 * checked is the traffic to the files API and the board's own PNG export (`exportBoard`), which is empty (`null`)
 * as long as nothing is on the board.
 */
test.describe.configure({ mode: 'serial' });

let a: Page;
let b: Page;
let boardUrl: string;
const BOARD_NAME = 'E2E images';

/** The size of the board's PNG export in bytes, or 0 when there is nothing to export. */
async function exportedPngSize(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const canvas = document.querySelector('elysion-canvas') as HTMLElement & {
      exportBoard(format: string): Promise<Blob | null>;
    };
    return (await canvas.exportBoard('png'))?.size ?? 0;
  });
}

test.beforeAll(async ({ browser }) => {
  a = await login(browser, USER_A);
  b = await login(browser, USER_B);
  // Excalidraw opens the image dialog with the File System Access API when the browser has it, which Playwright does not
  // report as a file chooser. Without it the dialog is an <input type=file>, which it does (the pages load again below).
  await a.context().addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
  });
});

test.afterAll(async () => {
  if (a && boardUrl) {
    await a.goto('/');
    await a.getByText(BOARD_NAME).first().hover();
    await a
      .getByRole('button', { name: new RegExp(`^Delete the board ${BOARD_NAME}`) })
      .click({ force: true });
    await a.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(a.getByText(BOARD_NAME)).toHaveCount(0);
  }
  await a?.context().close();
  await b?.context().close();
});

test('a blank board is shared with a second person', async () => {
  await a
    .getByRole('button', { name: /New board/ })
    .first()
    .click();
  await a.getByRole('textbox', { name: 'Board name' }).fill(BOARD_NAME);
  await a.getByRole('button', { name: 'Create' }).click();
  await expect(a).toHaveURL(/\/board\/[0-9a-f-]+$/);
  boardUrl = a.url();
  await expect(a.getByText('Connected', { exact: true })).toBeVisible();

  await a.getByRole('button', { name: /^Share/ }).click();
  await a.getByPlaceholder('name@example.com').fill(emailOf(USER_B));
  await a.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(a.getByText(emailOf(USER_B))).toBeVisible();
  await a.keyboard.press('Escape');

  await openBoard(a, boardUrl);
  await openBoard(b, boardUrl);
  expect(await exportedPngSize(b)).toBe(0);
});

test('an image inserted by one person shows for the other, and both keep it after a reload', async () => {
  const uploaded = a.waitForResponse(
    (r) => r.request().method() === 'PUT' && /\/api\/boards\/[^/]+\/files\//.test(r.url()),
  );
  const loadedByB = b.waitForResponse(
    (r) => r.request().method() === 'GET' && /\/api\/boards\/[^/]+\/files\//.test(r.url()),
  );

  const chooser = a.waitForEvent('filechooser');
  await a.getByRole('button', { name: /^Insert image/ }).click();
  await (
    await chooser
  ).setFiles({ name: 'gradient.png', mimeType: 'image/png', buffer: makePng(96, 64) });
  await a.mouse.click(640, 400); // the image goes where the pointer is

  expect((await uploaded).status()).toBe(204);
  expect((await loadedByB).status()).toBe(200);
  await expect.poll(() => exportedPngSize(a)).toBeGreaterThan(0);
  await expect.poll(() => exportedPngSize(b)).toBeGreaterThan(0);

  // The bytes come back from the store after a reload, for the one who inserted the image and for the other.
  await openBoard(a, boardUrl);
  await openBoard(b, boardUrl);
  await expect.poll(() => exportedPngSize(a)).toBeGreaterThan(0);
  await expect.poll(() => exportedPngSize(b)).toBeGreaterThan(0);
  // What B exports is the picture: more than the empty frame a missing file would leave.
  const size = await exportedPngSize(b);
  expect(size).toBeGreaterThan(400);
});
