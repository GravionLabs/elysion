import { type Page, expect, test } from '@playwright/test';
import { USER_A, USER_B, emailOf, login, openBoard } from './helpers.js';

/**
 * The grid (#753, #754): dots in the board's background, never Excalidraw's lines, snapping that is a setting of its own,
 * and a setting of the board that everybody on it sees (on by default). The canvas is drawn on a `<canvas>`, so what is
 * checked is the page's state (`data-grid` on the canvas root), the pixels of the static canvas (transparent where nothing
 * is drawn, so no grid lines on it) and the board's own JSON export (`exportBoard`).
 */
test.describe.configure({ mode: 'serial' });

let page: Page;
let other: Page;
let boardUrl: string;
const BOARD_NAME = 'E2E grid';

/** The first rectangle of the board as exported: where it ended up. */
async function firstRectangle(): Promise<{ x: number; y: number } | undefined> {
  return page.evaluate(async () => {
    const canvas = document.querySelector('elysion-canvas') as HTMLElement & {
      exportBoard(format: string): Promise<Blob | null>;
    };
    const blob = await canvas.exportBoard('excalidraw');
    if (!blob) return undefined;
    const scene = JSON.parse(await blob.text()) as {
      elements: { type: string; x: number; y: number }[];
    };
    return scene.elements.find((element) => element.type === 'rectangle');
  });
}

/** How many pixels of a row of the static canvas are not transparent. */
async function opaquePixelsInRow(y: number): Promise<number> {
  return page.evaluate((row) => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.static');
    if (!canvas) throw new Error('no static canvas');
    const scaled = Math.round(row * (canvas.height / canvas.clientHeight));
    const data = canvas.getContext('2d')!.getImageData(0, scaled, canvas.width, 1).data;
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) opaque++;
    return opaque;
  }, y);
}

test.beforeAll(async ({ browser }) => {
  page = await login(browser, USER_A);
  other = await login(browser, USER_B);
});

test.afterAll(async () => {
  if (page && boardUrl) {
    await page.goto('/');
    await page.getByText(BOARD_NAME).first().hover();
    await page
      .getByRole('button', { name: new RegExp(`^Delete the board ${BOARD_NAME}`) })
      .click({ force: true });
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText(BOARD_NAME)).toHaveCount(0);
  }
  await page?.context().close();
  await other?.context().close();
});

test('a new board shows the dots, and the canvas itself stays transparent', async () => {
  await page
    .getByRole('button', { name: /New board/ })
    .first()
    .click();
  await page.getByRole('textbox', { name: 'Board name' }).fill(BOARD_NAME);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/board\/[0-9a-f-]+$/);
  boardUrl = page.url();
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /^Share/ }).click();
  await page.getByPlaceholder('name@example.com').fill(emailOf(USER_B));
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText(emailOf(USER_B))).toBeVisible();
  await page.keyboard.press('Escape');
  await openBoard(page, boardUrl);
  await openBoard(other, boardUrl);

  await expect(page.locator('.elysion-canvas')).toHaveAttribute('data-grid', 'dots');
  await expect(other.locator('.elysion-canvas')).toHaveAttribute('data-grid', 'dots');
  expect(await opaquePixelsInRow(300)).toBe(0); // the dots are CSS: nothing is drawn on the canvas
});

test("the grid is the board's: turning it off with Ctrl+' shows for the other person and after a reload", async () => {
  await page.mouse.click(900, 500); // the canvas has the focus now
  await page.keyboard.press("Control+'");

  await expect(page.locator('.elysion-canvas')).not.toHaveAttribute('data-grid', 'dots');
  await expect(other.locator('.elysion-canvas')).not.toHaveAttribute('data-grid', 'dots');
  await openBoard(other, boardUrl);
  await expect(other.locator('.elysion-canvas')).not.toHaveAttribute('data-grid', 'dots');

  await other.mouse.click(900, 500);
  await other.keyboard.press("Control+'"); // either of them may turn it on again
  await expect(page.locator('.elysion-canvas')).toHaveAttribute('data-grid', 'dots');
});

test('a rectangle snaps to the grid by default, with no line grid showing while it is dragged', async () => {
  await page.getByRole('button', { name: 'Rectangle' }).click();
  await page.mouse.move(413, 337);
  await page.mouse.down();
  await page.mouse.move(500, 400, { steps: 4 });
  await page.mouse.move(578, 453, { steps: 4 });
  // Excalidraw's grid mode is on now (it is what snaps); its lines would be drawn on the static canvas, far from the rectangle.
  expect(await opaquePixelsInRow(120)).toBe(0);
  await page.mouse.up();

  await expect.poll(async () => (await firstRectangle())?.x).not.toBeUndefined();
  const rectangle = (await firstRectangle())!;
  expect(rectangle.x % 20).toBe(0);
  expect(rectangle.y % 20).toBe(0);
});
