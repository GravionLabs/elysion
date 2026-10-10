import { type Page, expect, test } from '@playwright/test';
import {
  USER_A,
  createBoard,
  deleteBoardsNamed,
  expectAccessible,
  login,
  openBoardList,
} from './helpers.js';

/**
 * Accessibility (#739): axe (WCAG 2.1 A and AA) on the board list, a room, the board page and each of its menus and
 * dialogs, in the light and in the dark theme. Excalidraw's canvas is the one known exception (`AXE_ALLOWLIST`).
 */
const BOARD = 'E2E accessibility';
const ROOM = 'E2E accessibility room';

let a: Page;

test.beforeAll(async ({ browser }) => {
  a = await login(browser, USER_A);
});

test.afterAll(async () => {
  if (a) {
    await openBoardList(a);
    await deleteBoardsNamed(a, BOARD);
    const room = a.getByRole('navigation', { name: 'Rooms' }).getByRole('link', { name: ROOM });
    if (await room.count()) {
      await room.click();
      await a.getByRole('button', { name: 'Delete room' }).click();
      await a.getByRole('alertdialog').getByRole('button', { name: 'Delete room' }).click();
    }
  }
  await a?.context().close();
});

test('the board list and a room', async () => {
  await openBoardList(a);
  await expectAccessible(a, 'the board list, no boards of ours');
  // The landmarks of the page: the rooms navigation and the main region.
  await expect(a.getByRole('navigation', { name: 'Rooms' })).toHaveCount(1);
  await expect(a.getByRole('main')).toHaveCount(1);

  await a.getByRole('button', { name: '+ New room' }).click();
  await expectAccessible(a, 'the board list with the new room form');
  await a.getByRole('textbox', { name: 'Room name' }).fill(ROOM);
  await a.getByRole('button', { name: 'Create', exact: true }).click();
  await a
    .getByRole('navigation', { name: 'Rooms' })
    .getByRole('link', { name: new RegExp(ROOM) })
    .click();
  await expectAccessible(a, 'a room');

  await a.getByRole('button', { name: 'Members' }).click();
  await expectAccessible(a, 'the members dialog of a room');
  await a.keyboard.press('Escape');

  // The app opens the list at the room that was open last: leave none behind for the other tests.
  await a.getByRole('button', { name: 'Delete room' }).click();
  await a.getByRole('alertdialog').getByRole('button', { name: 'Delete room' }).click();
  await expect(
    a.getByRole('navigation', { name: 'Rooms' }).getByRole('link', { name: ROOM }),
  ).toHaveCount(0);
});

test('the new board dialog and the board page with its menus', async () => {
  await openBoardList(a);
  await a
    .getByRole('button', { name: /New board/ })
    .first()
    .click();
  await expectAccessible(a, 'the new board dialog');
  await a.getByRole('textbox', { name: 'Board name' }).fill(BOARD);
  await a.getByText('Retrospective', { exact: true }).click();
  await a.getByRole('button', { name: 'Create' }).click();
  await expect(a.getByText('Connected', { exact: true })).toBeVisible();
  await a.waitForTimeout(1500);
  await expectAccessible(a, 'the board page');
  // The landmarks of the page: the top bar, the canvas as the main region.
  await expect(a.getByRole('banner')).toHaveCount(1);
  await expect(a.getByRole('main', { name: 'Board canvas' })).toHaveCount(1);

  for (const [button, where] of [
    ['Templates', 'the templates menu'],
    ['Export', 'the export menu'],
    ['Timer', 'the timer menu'],
    ['Voting', 'the voting menu'],
  ] as const) {
    await a.getByRole('button', { name: new RegExp(`^${button}`) }).click();
    await expectAccessible(a, where);
    await a.keyboard.press('Escape');
  }

  await a.getByRole('button', { name: /^Share/ }).click();
  await expectAccessible(a, 'the share dialog');
  await a.keyboard.press('Escape');

  await a.getByTestId('elysion-sticky-color').click();
  await expectAccessible(a, 'the sticky note menu');
  await a.keyboard.press('Escape');
});

test('the board page in the dark theme', async () => {
  await openBoardList(a);
  await createBoard(a, BOARD);
  await a
    .getByRole('button', { name: /dark|Dark/ })
    .first()
    .click();
  await expectAccessible(a, 'the board page, dark theme');
  await a.getByRole('button', { name: /^Share/ }).click();
  await expectAccessible(a, 'the share dialog, dark theme');
  await a.keyboard.press('Escape');
  await openBoardList(a);
  await expectAccessible(a, 'the board list, dark theme');
});

test('the menus and dialogs work with the keyboard and give the focus back', async () => {
  await openBoardList(a);
  await createBoard(a, BOARD);

  for (const [button, menu] of [
    [/^Templates/, 'Templates'],
    [/^Export/, 'Export'],
  ] as const) {
    const trigger = a.getByRole('button', { name: button, exact: false }).filter({
      hasNot: a.locator('.title-button'),
    });
    await trigger.first().focus();
    await a.keyboard.press('Enter');
    await expect(a.getByRole('menu', { name: menu })).toBeVisible();
    await a.keyboard.press('Escape');
    await expect(a.getByRole('menu', { name: menu })).toHaveCount(0);
    await expect(trigger.first()).toBeFocused();
  }

  const share = a.getByRole('button', { name: /^Share/ });
  await share.focus();
  await a.keyboard.press('Enter');
  const dialog = a.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // The focus is inside the dialog, and Escape closes it and returns the focus to the button.
  await expect(dialog.locator(':focus')).toHaveCount(1);
  await a.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(share).toBeFocused();
});

test('a board card opens with the keyboard', async () => {
  await openBoardList(a);
  await createBoard(a, BOARD);
  await openBoardList(a);
  const card = a
    .getByRole('main')
    .getByRole('link', { name: new RegExp(BOARD) })
    .first();
  await card.focus();
  await expect(card).toBeFocused();
  await a.keyboard.press('Enter');
  await expect(a).toHaveURL(/\/board\/[0-9a-f-]+$/);
});

test('the connection status is announced and motion is switched off when asked for', async () => {
  await a.emulateMedia({ reducedMotion: 'reduce' });
  await openBoardList(a);
  await createBoard(a, BOARD);
  await expect(a.getByRole('status').filter({ hasText: 'Connected' })).toBeVisible();
  const duration = await a
    .getByRole('button', { name: /^Share/ })
    .evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(['0s', '0.00001s', '1e-05s']).toContain(duration);
});
