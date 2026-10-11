import { type Page, expect, test } from '@playwright/test';
import { USER_A, expectAccessible, login } from './helpers.js';

/**
 * The administration pages (#659, ADR 0027). `dev` is the administrator of the dev realm (the realm role `elysion-admin`); `dev1` is
 * not. The administrator sees the overview, people, groups and rooms as metadata; makes a local group, renames it, adds a member
 * and deletes it again; and the person who is not an administrator has no menu entry and is told so at the address.
 */
test.describe.configure({ mode: 'serial' });

const ADMIN = 'dev';
const GROUP = 'E2E admin group';
const RENAMED = 'E2E admin group renamed';

let admin: Page;
let other: Page;

test.beforeAll(async ({ browser }) => {
  admin = await login(browser, ADMIN);
  other = await login(browser, USER_A);
});

test.afterAll(async () => {
  // A group left by a test that failed half way.
  if (admin) {
    await admin.goto('/admin/groups');
    for (const name of [GROUP, RENAMED]) {
      const del = admin.getByRole('button', { name: `Delete the group ${name}`, exact: true });
      if (await del.count()) {
        await del.click();
        await admin
          .getByRole('dialog')
          .getByRole('button', { name: 'Delete', exact: true })
          .click();
        await expect(del).toHaveCount(0);
      }
    }
  }
  await admin?.context().close();
  await other?.context().close();
});

test('the menu of an administrator has the way to the administration, and the overview shows numbers', async () => {
  await admin.goto('/');
  await admin.getByRole('button', { name: ADMIN, exact: true }).click();
  await admin.getByRole('menuitem', { name: 'Administration' }).click();

  await expect(admin).toHaveURL(/\/admin$/);
  await expect(admin.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(admin.getByRole('list', { name: 'Numbers' }).getByRole('listitem')).toHaveCount(4);
  await expect(admin.getByText('Identity provider (issuer)')).toBeVisible();
  await expectAccessible(admin, 'the administration overview');
});

test('the users page lists people with their groups and opens their roles', async () => {
  await admin.getByRole('link', { name: 'Users', exact: true }).click();

  await expect(admin.getByRole('heading', { name: 'Users' })).toBeVisible();
  await admin.getByRole('searchbox', { name: 'Search users' }).fill('dev1');
  await admin.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(admin.getByRole('row', { name: /dev1/ })).toBeVisible();
  await expectAccessible(admin, 'the users page');

  await admin
    .getByRole('button', { name: /^Show the rooms and boards of/ })
    .first()
    .click();
  const dialog = admin.getByRole('dialog');
  await expect(dialog.getByRole('heading', { level: 3, name: 'Rooms' })).toBeVisible();
  await expectAccessible(admin, 'the details of a person');
  await admin.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('a local group is made, renamed, gets a member and is deleted', async () => {
  await admin.getByRole('link', { name: 'Groups', exact: true }).click();
  await admin.getByRole('button', { name: 'New group', exact: true }).click();
  await admin.getByLabel('Name of the new group').fill(GROUP);
  await admin.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(admin.getByRole('row', { name: new RegExp(`^${GROUP} Local`) })).toBeVisible();
  await expectAccessible(admin, 'the groups page');

  await admin.getByRole('button', { name: `Rename the group ${GROUP}` }).click();
  await admin.getByLabel('New name').fill(RENAMED);
  await admin.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(admin.getByRole('button', { name: `Show the members of ${RENAMED}` })).toBeVisible();

  await admin.getByRole('button', { name: `Show the members of ${RENAMED}` }).click();
  const dialog = admin.getByRole('dialog');
  await dialog.getByLabel('Find a person to add').fill('dev2');
  await dialog.getByRole('button', { name: 'Search', exact: true }).click();
  await dialog
    .getByRole('button', { name: /^Add .* to the group$/ })
    .first()
    .click();
  await expect(dialog.getByRole('button', { name: /^Remove .* from the group$/ })).toHaveCount(1);
  await expectAccessible(admin, 'the members of a group');
  await admin.keyboard.press('Escape');

  await admin.getByRole('button', { name: `Delete the group ${RENAMED}` }).click();
  await expect(admin.getByRole('dialog')).toContainText('memberships');
  await admin.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(admin.getByRole('button', { name: `Show the members of ${RENAMED}` })).toHaveCount(
    0,
  );
});

test('the rooms page lists rooms as numbers', async () => {
  await admin.getByRole('link', { name: 'Rooms', exact: true }).click();

  await expect(admin.getByRole('heading', { name: 'Rooms' })).toBeVisible();
  await expect(admin.getByRole('columnheader', { name: 'Owner' })).toBeVisible();
  await expectAccessible(admin, 'the rooms page');
});

test('a person who is not an administrator has no menu entry and is told so at the address', async () => {
  await other.goto('/');
  await other.getByRole('button', { name: USER_A, exact: true }).click();
  await expect(other.getByRole('menuitem', { name: 'Log out' })).toBeVisible();
  await expect(other.getByRole('menuitem', { name: 'Administration' })).toHaveCount(0);
  await other.keyboard.press('Escape');

  await other.goto('/admin/groups');
  await expect(other.getByRole('heading', { name: 'You are not an administrator' })).toBeVisible();
  await expect(other.getByRole('link', { name: 'Back to your boards' })).toBeVisible();
  await expectAccessible(other, 'the notice for a person who is not an administrator');
});

test('the pages work at the width of a phone', async () => {
  await admin.setViewportSize({ width: 390, height: 800 });
  await admin.goto('/admin/users');

  await expect(admin.getByRole('heading', { name: 'Users' })).toBeVisible();
  await expect(admin.getByRole('navigation', { name: 'Administration' })).toBeVisible();
  const overflow = await admin.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  await expectAccessible(admin, 'the users page on a phone');
});
