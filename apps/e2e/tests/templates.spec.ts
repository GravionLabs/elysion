import { type Page, expect, test } from '@playwright/test';
import {
  USER_A,
  createBoard,
  deleteBoardsNamed,
  elementCount,
  login,
  openBoardList,
} from './helpers.js';

/**
 * Templates (#715): a board made from each built-in template has the template's elements (the counts are those of
 * the `.excalidraw` files under apps/business-backend/src/Elysion.BusinessBackend.Api/Templates), a template can be
 * added to a board that exists, and the current board can be saved as a template of one's own, found in the menu and
 * deleted again.
 */
test.describe.configure({ mode: 'serial' });

const BUILT_IN = [
  { name: 'Retrospective', elements: 18 },
  { name: 'Kanban', elements: 14 },
  { name: 'Brainstorming', elements: 14 },
];
const BOARD = 'E2E templates';
const OWN_TEMPLATE = 'E2E own template';

let a: Page;

const templatesMenu = (page: Page) => page.getByRole('menu', { name: 'Templates' });

async function openTemplates(page: Page) {
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await expect(templatesMenu(page).getByRole('menuitem', { name: /^Kanban/ })).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
  a = await login(browser, USER_A);
});

test.afterAll(async () => {
  if (a) {
    // The own template, if a test failed before it was deleted, and the boards.
    await openBoardList(a);
    for (const name of [BOARD, ...BUILT_IN.map((t) => `${BOARD} ${t.name}`)]) {
      await deleteBoardsNamed(a, name);
    }
  }
  await a?.context().close();
});

for (const template of BUILT_IN) {
  test(`a board made from the ${template.name} template has its ${template.elements} elements`, async () => {
    await openBoardList(a);
    await createBoard(a, `${BOARD} ${template.name}`, template.name);
    await expect.poll(() => elementCount(a), { timeout: 20_000 }).toBe(template.elements);
  });
}

test('a template is added to a board that exists', async () => {
  await openBoardList(a);
  await createBoard(a, BOARD);
  expect(await elementCount(a)).toBe(0);

  await openTemplates(a);
  await templatesMenu(a)
    .getByRole('menuitem', { name: /^Kanban/ })
    .click();
  await expect.poll(() => elementCount(a)).toBe(14);

  await openTemplates(a);
  await templatesMenu(a)
    .getByRole('menuitem', { name: /^Brainstorming/ })
    .click();
  await expect.poll(() => elementCount(a)).toBe(28);
});

test('the board is saved as a template of one’s own, found in the menu and deleted', async () => {
  await openTemplates(a);
  await templatesMenu(a).getByRole('menuitem', { name: 'Save board as template…' }).click();
  const form = a.getByRole('form', { name: 'Save as template' });
  await form.getByRole('textbox', { name: 'Template name' }).fill(OWN_TEMPLATE);
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form).toHaveCount(0);

  await openTemplates(a);
  await expect(
    templatesMenu(a).getByRole('menuitem', { name: new RegExp(`^${OWN_TEMPLATE}`) }),
  ).toBeVisible();

  await a.getByRole('button', { name: `Delete the template ${OWN_TEMPLATE}` }).click();
  await templatesMenu(a)
    .getByRole('menuitem', { name: `Delete “${OWN_TEMPLATE}”?` })
    .click();
  await expect(
    templatesMenu(a).getByRole('menuitem', { name: new RegExp(`^${OWN_TEMPLATE}`) }),
  ).toHaveCount(0);
});
