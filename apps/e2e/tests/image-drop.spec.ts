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
import { makePng } from './png.js';

/**
 * Images dropped on the canvas or pasted into it (#724): several files become a row at the drop point, an SVG becomes a PNG
 * (the object store keeps no SVG), what cannot be added is said, a viewer cannot drop, and the other person sees the images.
 * Playwright cannot drag a file from the desktop, so the page gets the `drop` and `paste` events a browser would send.
 */
test.describe.configure({ mode: 'serial' });

const BOARD = 'E2E image drop';
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#3b82f6"/></svg>`;

let a: Page;
let b: Page;
let boardUrl: string;

interface Sent {
  name: string;
  type: string;
  base64: string;
}

const file = (name: string, type: string, bytes: Buffer | string): Sent => ({
  name,
  type,
  base64: Buffer.from(bytes).toString('base64'),
});

/** Sends a `drop` (at a point of the page) or a `paste` carrying the files, as a browser does. */
async function send(page: Page, kind: 'drop' | 'paste', files: Sent[], at = { x: 640, y: 400 }) {
  await page.evaluate(
    ({ kind: eventKind, files: sent, at: point }) => {
      const transfer = new DataTransfer();
      for (const item of sent) {
        const bytes = Uint8Array.from(atob(item.base64), (c) => c.charCodeAt(0));
        transfer.items.add(new File([bytes], item.name, { type: item.type }));
      }
      if (eventKind === 'drop') {
        const target = document.elementFromPoint(point.x, point.y) ?? document.body;
        target.dispatchEvent(
          new DragEvent('drop', {
            dataTransfer: transfer,
            clientX: point.x,
            clientY: point.y,
            bubbles: true,
            cancelable: true,
          }),
        );
      } else {
        (document.activeElement ?? document.body).dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
        );
      }
    },
    { kind, files, at },
  );
}

const images = async (page: Page) =>
  (await boardElements(page)).filter((element) => element.type === 'image');

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

test('two PNGs dropped together become a row at the drop point, and the other person sees both', async () => {
  const uploads: string[] = [];
  a.on('request', (request) => {
    if (request.method() === 'PUT' && /\/api\/boards\/[^/]+\/files\//.test(request.url())) {
      uploads.push(request.headers()['content-type'] ?? '');
    }
  });

  await send(a, 'drop', [
    file('one.png', 'image/png', makePng(96, 64)),
    file('two.png', 'image/png', makePng(64, 96)),
  ]);

  await expect.poll(async () => (await images(a)).length).toBe(2);
  const [first, second] = (await images(a)).sort((p, q) => p.x - q.x);
  expect(second!.x).toBeGreaterThan(first!.x + first!.width); // side by side with a gap
  expect(Math.abs(first!.y + first!.height / 2 - (second!.y + second!.height / 2))).toBeLessThan(1); // one line
  await expect.poll(async () => (await images(b)).length).toBe(2);
  expect(uploads).toEqual(['image/png', 'image/png']);
});

test('a pasted PNG is added in the middle of the view', async () => {
  await send(a, 'paste', [file('pasted.png', 'image/png', makePng(40, 40))]);

  await expect.poll(async () => (await images(a)).length).toBe(3);
  await expect.poll(async () => (await images(b)).length).toBe(3);
});

test('an SVG becomes a PNG: the object store never gets an SVG', async () => {
  const types: string[] = [];
  a.on('request', (request) => {
    if (request.method() === 'PUT' && /\/files\//.test(request.url())) {
      types.push(request.headers()['content-type'] ?? '');
    }
  });

  await send(a, 'drop', [file('drawing.svg', 'image/svg+xml', SVG)], { x: 400, y: 300 });

  await expect.poll(async () => (await images(a)).length).toBe(4);
  await expect.poll(() => types).toEqual(['image/png']);
});

test('an image the board cannot keep is refused with a message, and nothing is added', async () => {
  await send(a, 'drop', [file('photo.bmp', 'image/bmp', Buffer.from('BM'))]);

  await expect(a.getByRole('status').filter({ hasText: 'photo.bmp was not added' })).toBeVisible();
  expect((await images(a)).length).toBe(4);
});

test('a viewer cannot drop an image', async () => {
  await a.getByRole('button', { name: /^Share/ }).click();
  await a.getByRole('combobox').nth(2).selectOption('Viewer');
  await a.keyboard.press('Escape');
  await openBoard(b, boardUrl);

  await send(b, 'drop', [file('nope.png', 'image/png', makePng(50, 50))]);
  await b.waitForTimeout(1500);

  expect((await images(b)).length).toBe(4);
  expect((await images(a)).length).toBe(4);
});
