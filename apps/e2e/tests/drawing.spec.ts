import { type Page, expect, test } from '@playwright/test';
import {
  type BoardElement,
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
 * The drawing tools (#717): user A draws a rectangle, a sticky note of a chosen color, text and arrows, connects two
 * shapes with the connection points and moves one, and undoes and redoes; user B, in a second browser on the same
 * board, has to end up with the same elements. The canvas is a `<canvas>`, so the drawing is done with the mouse in
 * page coordinates and read back from the board's own Excalidraw export.
 */
test.describe.configure({ mode: 'serial' });

const BOARD = 'E2E drawing';

let a: Page;
let b: Page;
let boardUrl: string;

/** Drags the mouse on the page in steps, as a person draws. */
async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(from[0] + (to[0] - from[0]) / 2, from[1] + (to[1] - from[1]) / 2, {
    steps: 5,
  });
  await page.mouse.move(...to, { steps: 5 });
  await page.mouse.up();
}

/** A point of the canvas, given relative to its top left corner. */
async function onCanvas(page: Page, x: number, y: number): Promise<[number, number]> {
  const box = await page.locator('elysion-canvas').boundingBox();
  expect(box).not.toBeNull();
  return [box!.x + x, box!.y + y];
}

async function pick(page: Page, tool: string) {
  await page.getByTestId(`elysion-tool-${tool}`).click();
}

/** The elements of one type, in the order of the document. */
async function ofType(page: Page, type: string): Promise<BoardElement[]> {
  return (await boardElements(page)).filter((element) => element.type === type);
}

/** Both people see as many elements as `expected`. */
async function bothSee(expected: number) {
  await expect.poll(() => elementCount(a)).toBe(expected);
  await expect.poll(() => elementCount(b)).toBe(expected);
}

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

test('a rectangle drawn by one person shows for the other, in the same place', async () => {
  await pick(a, 'rectangle');
  await drag(a, await onCanvas(a, 320, 150), await onCanvas(a, 480, 250));
  await bothSee(1);

  const [mine] = await ofType(a, 'rectangle');
  const [theirs] = await ofType(b, 'rectangle');
  expect(theirs!.id).toBe(mine!.id);
  expect(theirs!.x).toBe(mine!.x);
  expect(theirs!.y).toBe(mine!.y);
  expect(mine!.width).toBeGreaterThan(100);
});

test('text typed by one person is read by the other', async () => {
  await pick(a, 'text');
  await a.mouse.click(...(await onCanvas(a, 620, 170)));
  await a.keyboard.type('Hello Elysion');
  await a.keyboard.press('Escape');
  await a.keyboard.press('Escape');

  await bothSee(2);
  await expect
    .poll(async () => (await ofType(b, 'text')).map((t) => t.text))
    .toEqual(['Hello Elysion']);
});

test('a sticky note takes the color chosen for it', async () => {
  await a.getByTestId('elysion-tool-sticky').click();
  await bothSee(4); // the note is a rectangle and its text
  const [first] = (await ofType(a, 'rectangle')).slice(-1);

  await a.getByTestId('elysion-sticky-color').click();
  await a.getByRole('menuitemradio', { name: 'Blue sticky note' }).click();
  await bothSee(6);

  const notes = (await ofType(b, 'rectangle')).slice(-2);
  expect(notes[1]!.id).not.toBe(first!.id);
  expect(notes[1]!.backgroundColor).not.toBe(first!.backgroundColor);
});

test('an arrow is drawn', async () => {
  await pick(a, 'arrow');
  await drag(a, await onCanvas(a, 320, 330), await onCanvas(a, 520, 330));
  await bothSee(7);
  const [arrow] = await ofType(b, 'arrow');
  expect(arrow!.points!.at(-1)![0]).toBeGreaterThan(100);
});

test('a connector made from a connection point follows the shape that is moved', async () => {
  // Two shapes in the lower right, away from the earlier drawing.
  await pick(a, 'rectangle');
  await drag(a, await onCanvas(a, 700, 520), await onCanvas(a, 800, 580));
  await pick(a, 'rectangle');
  await drag(a, await onCanvas(a, 950, 520), await onCanvas(a, 1050, 580));
  const [source, target] = (await ofType(a, 'rectangle')).slice(-2) as [BoardElement, BoardElement];
  const before = await elementCount(a);

  // Hovering the first shape shows its connection points; dragging from the right one onto the second connects them.
  await a.mouse.move(...(await onCanvas(a, 750, 550)));
  const point = a.locator(`[data-connection-point="${source.id}:right"]`);
  await expect(point).toBeVisible();
  const box = (await point.boundingBox())!;
  await drag(a, [box.x + box.width / 2, box.y + box.height / 2], await onCanvas(a, 1000, 550));

  await expect.poll(() => elementCount(a)).toBe(before + 1);
  const [arrow] = (await ofType(a, 'arrow')).slice(-1) as [BoardElement];
  expect(arrow.startBinding?.elementId).toBe(source.id);
  expect(arrow.endBinding?.elementId).toBe(target.id);
  const endY = (element: BoardElement) => element.y + element.points!.at(-1)![1];

  // Move the second shape down: the end of the arrow goes with it, on both screens.
  await a.keyboard.press('Escape');
  await pick(a, 'selection');
  await drag(a, await onCanvas(a, 1000, 520), await onCanvas(a, 1000, 620));
  for (const page of [a, b]) {
    await expect
      .poll(async () => {
        const moved = (await ofType(page, 'arrow')).find((element) => element.id === arrow.id)!;
        return endY(moved) - endY(arrow);
      })
      .toBeGreaterThan(50);
  }
});

test('undo takes the last drawing back and redo returns it', async () => {
  const before = await elementCount(a);
  await pick(a, 'ellipse');
  await drag(a, await onCanvas(a, 320, 500), await onCanvas(a, 420, 580));
  await bothSee(before + 1);

  await a.getByTestId('elysion-undo').click();
  await bothSee(before);

  await a.getByTestId('elysion-redo').click();
  await bothSee(before + 1);
});
