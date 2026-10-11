import { type Page, expect, test } from '@playwright/test';
import {
  USER_A,
  USER_B,
  boardElements,
  canUseCompose,
  compose,
  createBoard,
  deleteBoardsNamed,
  elementCount,
  emailOf,
  expectAccessible,
  login,
  openBoard,
  waitForApi,
  openBoardList,
} from './helpers.js';

/**
 * Losing and regaining the connection (#718): the realtime service is stopped while two people are on a board; the
 * top bar no longer says "Connected", the person who draws during the outage keeps what was drawn, and when the service is back
 * the status returns and the other person has everything. A second run with a WS token of 5 seconds shows that a token
 * that has run out neither ends an open connection nor stops a reconnect.
 *
 * It stops a container of the stack the tests run against, so it is skipped where that is not allowed (`E2E_NO_COMPOSE`).
 * (`docker compose stop` and not `pause`: a frozen process keeps its TCP connections open and the browser would not
 * notice anything.)
 */
test.describe.configure({ mode: 'serial' });
test.skip(!canUseCompose, 'E2E_NO_COMPOSE is set: the stack is not ours to stop');

const BOARD = 'E2E reconnect';

let a: Page;
let b: Page;
let boardUrl: string;

async function drawRectangle(page: Page, x: number, y: number) {
  const box = (await page.locator('elysion-canvas').boundingBox())!;
  await page.getByTestId('elysion-tool-rectangle').click();
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + 60, box.y + y + 40, { steps: 5 });
  await page.mouse.up();
}

async function bothSee(expected: number) {
  await expect.poll(() => elementCount(a), { timeout: 60_000 }).toBe(expected);
  await expect.poll(() => elementCount(b), { timeout: 60_000 }).toBe(expected);
}

/** Stops the realtime service, lets `during` run while it is down, and starts it again. */
async function outage(during: () => Promise<void>) {
  await compose(['stop', 'realtime']);
  try {
    // "Offline" between two attempts and "Connecting…" during one: since the realtime service shuts down gracefully
    // (SIGTERM saves the rooms) an attempt takes about a second to fail, so the bar mostly says "Connecting…".
    await expect(a.getByText('Connected', { exact: true })).toHaveCount(0, { timeout: 30_000 });
    await expect(a.getByText(/^\s*(Offline|Connecting…)\s*$/)).toBeVisible();
    await during();
  } finally {
    await compose(['start', 'realtime']);
  }
  await expect(a.getByText('Connected', { exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(b.getByText('Connected', { exact: true })).toBeVisible({ timeout: 90_000 });
}

test.beforeAll(async ({ browser }) => {
  // A WS token that lives for 5 seconds (the BFF is the only one that reads it).
  await compose(['up', '-d', '--no-deps', 'bff'], { WS_TOKEN_TTL_SECONDS: '5' });
  await waitForApi();
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
});

test.afterAll(async () => {
  await compose(['start', 'realtime']).catch(() => undefined);
  await compose(['up', '-d', '--no-deps', 'bff']).catch(() => undefined); // back to the normal token lifetime
  await waitForApi().catch(() => undefined);
  if (a) {
    await openBoardList(a);
    await deleteBoardsNamed(a, BOARD);
  }
  await a?.context().close();
  await b?.context().close();
});

test('what one person draws during an outage reaches the other when the service is back', async () => {
  await drawRectangle(a, 320, 150);
  await bothSee(1);

  await outage(async () => {
    await expect(b.getByText('Connected', { exact: true })).toHaveCount(0, { timeout: 30_000 });
    await drawRectangle(a, 320, 350);
    await drawRectangle(a, 520, 350);
    expect(await elementCount(a)).toBe(3);
    expect(await elementCount(b)).toBe(1);
  });

  await bothSee(3);
});

test('a token that has run out ends neither an open connection nor a reconnect', async () => {
  // The token of this connection is past its 5 seconds: the connection stays up and keeps carrying changes.
  await a.waitForTimeout(8_000);
  await expect(a.getByText('Connected', { exact: true })).toBeVisible();
  await drawRectangle(a, 720, 150);
  await bothSee(4);

  await outage(async () => {
    await a.waitForTimeout(8_000); // longer than a token lives
  });

  await bothSee(4);
  await drawRectangle(b, 720, 350);
  await bothSee(5);
  expect((await boardElements(a)).length).toBe(5);
  await expect(a.getByRole('alert')).toHaveCount(0);
});

/** The text of the board's text elements, as the canvas holds them. */
const texts = async (page: Page) =>
  (await boardElements(page)).filter((element) => element.type === 'text').map((e) => e.text);

async function editText(page: Page, x: number, y: number, text: string) {
  const box = (await page.locator('elysion-canvas').boundingBox())!;
  await page.mouse.dblclick(box.x + x, box.y + y);
  await page.keyboard.press('Control+A');
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
}

test('both people change the same text during an outage and have the same text when it is back (#735)', async () => {
  const box = (await a.locator('elysion-canvas').boundingBox())!;
  await a.getByTestId('elysion-tool-text').click();
  await a.mouse.click(box.x + 420, box.y + 470);
  await a.keyboard.type('Original');
  await a.keyboard.press('Escape');
  await a.keyboard.press('Escape');
  await bothSee(6);

  await outage(async () => {
    await expect(b.getByText('Connected', { exact: true })).toHaveCount(0, { timeout: 30_000 });
    await editText(a, 450, 485, 'Changed by A');
    await editText(b, 450, 485, 'Changed by B');
    expect(await texts(a)).toEqual(['Changed by A']);
    expect(await texts(b)).toEqual(['Changed by B']);

    // After 10 seconds the bar says that the work is kept on the device, with what is waiting to be sent.
    await expect(
      a.getByText(/Working offline\. Your changes are saved on this device/),
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect(a.getByText(/changes? waiting/)).toBeVisible();
    await expectAccessible(a, 'the offline bar');
  });

  await expect(a.getByText(/^\s*Back online/)).toBeVisible({ timeout: 30_000 });
  let seen = '';
  await expect
    .poll(
      async () => {
        const [mine, theirs] = [await texts(a), await texts(b)];
        seen = JSON.stringify({ a: mine, b: theirs });
        return (
          mine.length === 1 && mine[0] === theirs[0] && /^Changed by [AB]$/.test(mine[0] ?? '')
        );
      },
      { timeout: 60_000 },
    )
    .toBe(true)
    .catch((error: Error) => {
      throw new Error(`${error.message}\nthe texts at the end: ${seen}`);
    });
});

test('a tab that is reloaded during an outage keeps what was drawn, and sends it when the service is back (#735)', async () => {
  await outage(async () => {
    await drawRectangle(a, 620, 450);
    expect(await elementCount(a)).toBe(7);
    await a.waitForTimeout(1500); // the change is written to the device
    await a.reload(); // the service is still down: the page comes up without the board
  });

  await bothSee(7);
  // Nothing of it is left on the device once it was sent.
  await expect
    .poll(
      () =>
        a.evaluate(async () => {
          const names = ((await indexedDB.databases?.()) ?? []).map((d) => d.name ?? '');
          return names.filter((name) => name.startsWith('elysion-board:')).length;
        }),
      { timeout: 30_000 },
    )
    .toBe(0);
});
