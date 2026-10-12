import { type Page, expect, test } from '@playwright/test';
import {
  USER_A,
  USER_B,
  createBoard,
  deleteBoardsNamed,
  emailOf,
  expectAccessible,
  login,
  openBoard,
  openBoardList,
} from './helpers.js';

/**
 * Comments (#733): a viewer comments on the board (the one thing the realtime service lets a viewer write), the owner sees it at
 * once, replies with a mention and resolves it, and the viewer sees that. The comments live in the board's document, so this
 * runs through the shell, the canvas, the realtime service and the persistence.
 */
test.describe.configure({ mode: 'serial' });

const BOARD = 'E2E comments';

let a: Page;
let b: Page;
let boardUrl: string;

const panel = (page: Page) => page.getByRole('complementary', { name: 'Comments' });
const markers = (page: Page) => page.locator('[data-comment-marker]');
const openComments = (page: Page) => page.getByTestId('elysion-tool-comments').click();

test.beforeAll(async ({ browser }) => {
  a = await login(browser, USER_A);
  b = await login(browser, USER_B);
  await openBoardList(a);
  boardUrl = await createBoard(a, BOARD);
  await a.getByRole('button', { name: /^Share/ }).click();
  await a.getByRole('combobox', { name: 'Person' }).fill(emailOf(USER_B));
  await a.getByLabel('Role of the new member').selectOption('Viewer');
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

test('a viewer comments on a point of the board and the owner sees it at once', async () => {
  // B is a viewer: the canvas is read-only, and the comments are still there.
  await expect(b.locator('elysion-canvas[readonly]')).toHaveCount(1);
  await openComments(b);
  await expect(b.getByText('Click an element or a point')).toBeVisible();

  const box = (await b.locator('elysion-canvas').boundingBox())!;
  await b.mouse.click(box.x + 500, box.y + 350);
  await panel(b)
    .getByPlaceholder(/^Write a comment/)
    .fill('Is this the right order?');
  await panel(b).getByRole('button', { name: 'Comment', exact: true }).click();

  await expect(markers(b)).toHaveCount(1);
  await expect(markers(a)).toHaveCount(1);
  await expect(markers(a).first()).toHaveAttribute('aria-label', '1 comment');
});

test('a viewer can mention a person who has not commented, found through the people search', async () => {
  // Nobody but B has written on this board yet: the owner is found by the search, not by the comments.
  await markers(b).first().click();
  const reply = panel(b).getByPlaceholder('Reply…');
  await reply.fill('Ask @dev');

  await expect(b.getByRole('option', { name: USER_A, exact: true })).toBeVisible();
  await expect(panel(b).getByRole('status').filter({ hasText: /found/ })).toBeAttached();
  await expectAccessible(b, 'the people offered for a mention');

  await reply.fill(''); // nothing is sent: the next test counts the messages
  await expect(b.getByRole('option')).toHaveCount(0);
});

test('the owner replies with a mention, resolves the thread and the viewer sees that', async () => {
  await markers(a).first().click();
  await expect(panel(a).getByText('Is this the right order?')).toBeVisible();

  const reply = panel(a).getByPlaceholder('Reply…');
  await reply.fill('Yes, thanks @');
  // The owner can list the members; the one picked is stored by id and shown by name.
  await a.getByRole('option').filter({ hasText: /2/ }).first().click();
  await panel(a).getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(markers(a).first()).toHaveAttribute('aria-label', '2 comments');
  await expect(panel(a).getByText(/^Yes, thanks @\S+/)).toBeVisible();
  await expectAccessible(a, 'the comments panel');

  await panel(a).getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(panel(a).getByRole('heading', { name: 'Resolved (1)' })).toBeVisible();

  // B reads the thread, with the mention as a name, and sees who resolved it.
  await markers(b).first().click();
  await expect(panel(b).getByRole('heading', { name: 'Resolved (1)' })).toBeVisible();
  await expect(panel(b).getByText(/Resolved by/)).toBeVisible();
  await expect(panel(b).getByText(/^Yes, thanks @\S+/)).toBeVisible();
  await expect(panel(b).getByText('@?')).toHaveCount(0);
});

test('a viewer deletes their own comment, not the owner’s, and the owner can delete any', async () => {
  // B may delete B's message only.
  const own = panel(b).getByRole('button', { name: /^Delete the comment of/ });
  await expect(own).toHaveCount(1);

  // A, the owner, sees a delete button on every message.
  await expect(panel(a).getByRole('button', { name: /^Delete the comment of/ })).toHaveCount(2);

  await own.click();
  await expect(panel(a).getByRole('button', { name: /^Delete the comment of/ })).toHaveCount(1);
});

test('the comments are part of the board: they are there after a reload', async () => {
  await a.reload();
  await expect(a.getByText('Connected', { exact: true })).toBeVisible();
  await expect(markers(a)).toHaveCount(1);
});
