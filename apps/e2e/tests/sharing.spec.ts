import { type Page, expect, test } from '@playwright/test';
import {
  USER_A,
  boardCard,
  createBoard,
  deleteBoardsNamed,
  expectAccessible,
  login,
  loginThroughMicrosoft,
  openBoardList,
} from './helpers.js';

/**
 * Sharing with people and groups (#663, #652): the Share dialog finds a person by part of the name and adds the one chosen from the
 * list, a room gets a group with a role (the stand-in for Microsoft Entra ID makes the groups of `erika` when she signs in), and the
 * dialog of a board in that room says who else has access through the room.
 */
test.describe.configure({ mode: 'serial' });

const PERSON = 'erika';
const GROUP = '11111111-1111-4111-8111-111111111111';
const ROOM = 'E2E share room';
const BOARD = 'E2E share room board';

let a: Page;

const roomLink = (page: Page) =>
  page
    .getByRole('navigation', { name: 'Rooms' })
    .getByRole('link', { name: new RegExp(`^${ROOM} \\d+$`) });
const dialog = (page: Page) => page.getByRole('dialog', { name: /^Share/ });

test.beforeAll(async ({ browser }) => {
  // Her first sign-in makes her user and her two groups in Elysion; nobody can find them before.
  const erika = await loginThroughMicrosoft(browser, PERSON);
  await erika.context().close();
  a = await login(browser, USER_A);
});

test.afterAll(async () => {
  if (a) {
    await openBoardList(a);
    if (await roomLink(a).count()) {
      await roomLink(a).click();
      await a.getByRole('button', { name: 'Delete room' }).click();
      await a.getByRole('alertdialog').getByRole('button', { name: 'Delete room' }).click();
      await expect(roomLink(a)).toHaveCount(0);
    }
    await openBoardList(a);
    await deleteBoardsNamed(a, BOARD);
  }
  await a?.context().close();
});

test('a person is found by part of the name and added from the list with the keyboard', async () => {
  await openBoardList(a);
  await a.getByRole('button', { name: '+ New room' }).click();
  await a.getByRole('textbox', { name: 'Room name' }).fill(ROOM);
  await a.getByRole('button', { name: 'Create', exact: true }).click();
  await roomLink(a).click();
  await expect(a.getByRole('heading', { name: ROOM })).toBeVisible();
  await a.getByRole('button', { name: 'Members' }).click();

  const person = dialog(a).getByRole('combobox', { name: 'Person' });
  await person.fill('erik');
  await expect(dialog(a).getByRole('option', { name: /erika/ })).toBeVisible();
  await expectAccessible(a, 'the Share dialog with the list of people open');

  await person.press('ArrowDown');
  await person.press('Enter');
  await expect(person).toHaveValue(PERSON);
  await dialog(a).getByLabel('Role of the new member').selectOption('Viewer');
  await dialog(a).getByRole('button', { name: 'Add', exact: true }).first().click();

  await expect(dialog(a).getByText('erika@entra.local')).toBeVisible();
});

test('Escape closes the list first and the dialog after', async () => {
  const person = dialog(a).getByRole('combobox', { name: 'Person' });
  await person.fill('dev');
  await expect(dialog(a).getByRole('listbox').getByRole('option').first()).toBeVisible();

  await person.press('Escape');
  await expect(dialog(a).getByRole('listbox').getByRole('option')).toHaveCount(0);
  await expect(dialog(a)).toBeVisible();

  await person.press('Escape');
  await expect(dialog(a)).toHaveCount(0);
});

test('a group gets a role in the room, which can be changed and taken away', async () => {
  await a.getByRole('button', { name: 'Members' }).click();
  const groups = dialog(a).getByRole('region', { name: 'Groups' });
  await expect(groups.getByText('No group has a role in this room yet.')).toBeVisible();

  const group = groups.getByRole('combobox', { name: 'Group', exact: true });
  await group.fill('zzzz');
  await expect(groups.getByText('No group found.')).toBeVisible();

  await group.fill('1111');
  const option = groups.getByRole('option', { name: new RegExp(GROUP) });
  await expect(option).toContainText('from Microsoft Entra ID');
  await expectAccessible(a, 'the Share dialog with the list of groups open');
  await option.click();
  await groups.getByLabel('Role of the new group').selectOption('Editor');
  await groups.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(groups.getByLabel(`Role of the group ${GROUP}`)).toHaveValue('Editor');

  await groups.getByLabel(`Role of the group ${GROUP}`).selectOption('Viewer');
  await expect(groups.getByLabel(`Role of the group ${GROUP}`)).toHaveValue('Viewer');
  await a.reload();
  await a.getByRole('button', { name: 'Members' }).click();
  await expect(
    dialog(a).getByRole('region', { name: 'Groups' }).getByLabel(`Role of the group ${GROUP}`),
  ).toHaveValue('Viewer');
});

test('the dialog of a board in the room says who else has access through it', async () => {
  await a.keyboard.press('Escape');
  await createBoard(a, BOARD);
  await a.getByRole('button', { name: /^Share/ }).click();

  const access = dialog(a).getByRole('region', { name: 'Access through the room' });
  await expect(access).toContainText(ROOM);
  await expect(access).toContainText(`${GROUP} (Viewer)`);
  await expect(access.getByRole('link', { name: 'Manage the room' })).toBeVisible();
  await expect(access.locator('select, input')).toHaveCount(0);
  await a.keyboard.press('Escape');

  await openBoardList(a);
  await expect(boardCard(a, BOARD)).toBeVisible();
});

test('a group can be taken out of the room again', async () => {
  await openBoardList(a);
  await roomLink(a).click();
  await a.getByRole('button', { name: 'Members' }).click();
  const groups = dialog(a).getByRole('region', { name: 'Groups' });

  await groups.getByRole('button', { name: `Remove the group ${GROUP}` }).click();

  await expect(groups.getByText('No group has a role in this room yet.')).toBeVisible();
});
