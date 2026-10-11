import { type Page, expect, test } from '@playwright/test';
import {
  USER_A,
  USER_B,
  boardCard,
  createBoard,
  deleteBoardsNamed,
  expectAccessible,
  login,
  openBoardList,
} from './helpers.js';

/**
 * Deactivating a person and handing over what they own (#668, ADR 0027). `dev` administers; `dev2` makes a board and is deactivated:
 * the next request lands on the page that says so, they are not offered when somebody is added, and the administrator hands their
 * board to `dev1`, who then owns it. After the administrator reactivates `dev2` they can use Elysion again.
 */
test.describe.configure({ mode: 'serial' });

const ADMIN = 'dev';
const BOARD = 'E2E deactivate board';

let admin: Page;
let leaver: Page; // USER_B
let receiver: Page; // USER_A

test.beforeAll(async ({ browser }) => {
  admin = await login(browser, ADMIN);
  leaver = await login(browser, USER_B);
  receiver = await login(browser, USER_A);
});

/** The detail dialog of a person on the admin users page. */
async function openPerson(name: string): Promise<void> {
  await admin.goto('/admin/users');
  await admin.getByRole('searchbox', { name: 'Search users' }).fill(name);
  await admin.getByRole('searchbox', { name: 'Search users' }).press('Enter');
  await admin.getByRole('button', { name: `Show the rooms and boards of ${name}` }).click();
  await expect(admin.getByRole('dialog', { name })).toBeVisible();
}

test.afterAll(async () => {
  if (admin) {
    // The person must not stay deactivated when a test failed half way.
    await openPerson(USER_B);
    const reactivate = admin.getByRole('button', { name: 'Reactivate', exact: true });
    if (await reactivate.count()) {
      await reactivate.click();
      await expect(reactivate).toHaveCount(0);
    }
  }
  if (receiver) {
    await openBoardList(receiver);
    await deleteBoardsNamed(receiver, BOARD);
  }
  if (leaver) {
    await openBoardList(leaver);
    await deleteBoardsNamed(leaver, BOARD);
  }
  await admin?.context().close();
  await leaver?.context().close();
  await receiver?.context().close();
});

test('the administrator deactivates a person after a question that names the identity provider', async () => {
  await openBoardList(leaver);
  await createBoard(leaver, BOARD);

  await openPerson(USER_B);
  await admin.getByRole('button', { name: `Deactivate ${USER_B}`, exact: true }).click();
  const question = admin.getByRole('dialog', { name: 'Deactivate this person' });
  await expect(question).toContainText('identity provider');
  await expectAccessible(admin, 'the question to deactivate a person');
  await question.getByRole('button', { name: 'Deactivate', exact: true }).click();

  await expect(admin.getByRole('dialog', { name: USER_B })).toContainText('Deactivated on');
});

test('the deactivated person lands on the page that says so', async () => {
  await leaver.goto('/');
  await expect(
    leaver.getByRole('heading', { name: 'This account has been deactivated' }),
  ).toBeVisible();
  await expect(leaver).toHaveURL(/\/deactivated$/);
  await expectAccessible(leaver, 'the page of a deactivated account');
});

test('the administrator hands the board over, and the receiver owns it', async () => {
  await openPerson(USER_B);
  const dialog = admin.getByRole('dialog', { name: USER_B });
  await expect(dialog).toContainText('Owned by this person');

  await dialog.getByRole('searchbox', { name: 'Find the person who takes over' }).fill(USER_A);
  await dialog.getByRole('searchbox', { name: 'Find the person who takes over' }).press('Enter');
  await dialog.getByRole('button', { name: `Hand over to ${USER_A}`, exact: true }).click();
  const question = admin.getByRole('dialog', { name: 'Hand over the ownership' });
  await question.getByRole('button', { name: 'Hand over', exact: true }).click();

  await expect(dialog).toContainText(/Handed over: boards \d+, rooms \d+/);
  await openBoardList(receiver);
  await expect(boardCard(receiver, BOARD)).toBeVisible();

  // The new owner can share it, and the deactivated person is not offered.
  await boardCard(receiver, BOARD).click();
  await expect(receiver.getByText('Connected', { exact: true })).toBeVisible();
  await receiver.getByRole('button', { name: /^Share/ }).click();
  await receiver.getByRole('combobox', { name: 'Person' }).fill(USER_B);
  await expect(receiver.getByText(/Nobody found/)).toBeVisible();
  await receiver.keyboard.press('Escape');
});

test('after the administrator reactivates the person they can use Elysion again', async () => {
  await openPerson(USER_B);
  await admin.getByRole('button', { name: 'Reactivate', exact: true }).click();
  await expect(admin.getByRole('dialog', { name: USER_B })).toContainText('can use Elysion');

  await leaver.goto('/');
  await expect(leaver.getByRole('navigation', { name: 'Rooms' })).toBeVisible();
  await expect(boardCard(leaver, BOARD)).toHaveCount(0);
});
