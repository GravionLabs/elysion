import { type Page, expect, test } from '@playwright/test';
import {
  USER_A,
  USER_B,
  boardCard,
  createBoard,
  deleteBoardsNamed,
  emailOf,
  login,
  openBoardList,
} from './helpers.js';

/**
 * Rooms (#715): a room is a shared space for boards. User A makes one, shares it with user B as an editor and makes
 * a board in it; B sees the room and the board; A moves the board out, and B loses it. Deleting the room leaves
 * its boards.
 */
test.describe.configure({ mode: 'serial' });

const ROOM = 'E2E room';
const IN_ROOM = 'E2E room board';
const LEFT_IN_ROOM = 'E2E room board two';

let a: Page;
let b: Page;
let roomPath: string;

const roomLink = (page: Page) =>
  page.getByRole('navigation', { name: 'Rooms' }).getByRole('link', { name: new RegExp(ROOM) });

test.beforeAll(async ({ browser }) => {
  a = await login(browser, USER_A);
  b = await login(browser, USER_B);
});

test.afterAll(async () => {
  // Leave nothing behind: the room (if a test failed before it) and the boards.
  if (a) {
    await openBoardList(a);
    if (await roomLink(a).count()) {
      await roomLink(a).click();
      await a.getByRole('button', { name: 'Delete room' }).click();
      await a.getByRole('alertdialog').getByRole('button', { name: 'Delete room' }).click();
      await expect(roomLink(a)).toHaveCount(0);
    }
    await openBoardList(a);
    for (const name of [IN_ROOM, LEFT_IN_ROOM]) {
      await deleteBoardsNamed(a, name);
    }
  }
  await a?.context().close();
  await b?.context().close();
});

test('a room is made, shared with a second person and holds a board', async () => {
  await openBoardList(a);
  await a.getByRole('button', { name: '+ New room' }).click();
  await a.getByRole('textbox', { name: 'Room name' }).fill(ROOM);
  await a.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(roomLink(a)).toBeVisible();
  await roomLink(a).click();
  await expect(a.getByRole('heading', { name: ROOM })).toBeVisible();
  roomPath = new URL(a.url()).pathname;

  await a.getByRole('button', { name: 'Members' }).click();
  await a.getByPlaceholder('name@example.com').fill(emailOf(USER_B));
  await a.getByLabel('Role of the new member').selectOption('Editor');
  await a.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(a.getByRole('dialog').getByText(emailOf(USER_B))).toBeVisible();
  await a.getByRole('button', { name: 'Close' }).click();

  await createBoard(a, IN_ROOM);
  await openBoardList(a, roomPath);
  await expect(boardCard(a, IN_ROOM)).toBeVisible();
});

test('the second person sees the room and its board', async () => {
  await openBoardList(b);
  await expect(roomLink(b)).toBeVisible();
  await roomLink(b).click();
  await expect(boardCard(b, IN_ROOM)).toBeVisible();
});

test('a board moved out of the room is gone for the second person', async () => {
  await openBoardList(a, roomPath);
  await a.getByRole('button', { name: `Move the board ${IN_ROOM} to a room` }).click();
  await a.getByRole('menuitem', { name: 'Remove from room' }).click();
  await expect(boardCard(a, IN_ROOM)).toHaveCount(0);

  await openBoardList(b);
  await expect(roomLink(b)).toBeVisible();
  await expect(b.getByText(IN_ROOM, { exact: true })).toHaveCount(0);
});

test('deleting the room leaves its boards, without the room', async () => {
  await openBoardList(a, roomPath);
  await createBoard(a, LEFT_IN_ROOM);
  await openBoardList(a, roomPath);
  await a.getByRole('button', { name: 'Delete room' }).click();
  await a.getByRole('alertdialog').getByRole('button', { name: 'Delete room' }).click();
  await expect(roomLink(a)).toHaveCount(0);

  await openBoardList(a, '/rooms/none');
  await expect(boardCard(a, LEFT_IN_ROOM)).toBeVisible();
  await expect(boardCard(a, IN_ROOM)).toBeVisible();

  await openBoardList(b);
  await expect(roomLink(b)).toHaveCount(0);
  await expect(b.getByText(LEFT_IN_ROOM, { exact: true })).toHaveCount(0);
});
