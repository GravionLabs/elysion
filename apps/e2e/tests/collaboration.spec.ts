import { type Page, expect, test } from '@playwright/test';
import { USER_A, USER_B, emailOf, login, openBoard } from './helpers.js';

/**
 * Two people on one board, in two browsers: what the shell and the realtime service do together. The tests of the
 * file run in order on one board (made from the Retrospective template by user A, shared with user B as an editor).
 * The canvas draws on a canvas element, so what is checked is what shows in the page: the top bar, the voting results.
 */
test.describe.configure({ mode: 'serial' });

const NOTE_TEXT = 'Pairing made the release smooth';
/** The first note of the Retrospective template, in a 1280x800 window right after the board was made. */
const FIRST_NOTE = { x: 220, y: 305 };

let a: Page;
let b: Page;
let boardUrl: string;

test.beforeAll(async ({ browser }) => {
  a = await login(browser, USER_A);
  b = await login(browser, USER_B);
});

test.afterAll(async () => {
  // Leave nothing behind on the stack: A deletes the board it made.
  if (a && boardUrl) {
    await a.goto('/');
    await a.getByText('E2E retrospective').first().hover();
    await a
      .getByRole('button', { name: /^Delete the board E2E retrospective/ })
      .click({ force: true });
    await a.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(a.getByText('E2E retrospective')).toHaveCount(0);
  }
  await a?.context().close();
  await b?.context().close();
});

test('a board made from a template can be shared with a second person', async () => {
  await a
    .getByRole('button', { name: /New board/ })
    .first()
    .click();
  await a.getByRole('textbox', { name: 'Board name' }).fill('E2E retrospective');
  await a.getByText('Retrospective', { exact: true }).click();
  await a.getByRole('button', { name: 'Create' }).click();
  await expect(a).toHaveURL(/\/board\/[0-9a-f-]+$/);
  boardUrl = a.url();
  await expect(a.getByText('Connected', { exact: true })).toBeVisible();
  await a.waitForTimeout(3000); // the template is applied by this browser; the view fits to it

  await a.mouse.dblclick(FIRST_NOTE.x, FIRST_NOTE.y);
  await a.keyboard.type(NOTE_TEXT);
  await a.keyboard.press('Escape');
  await a.mouse.click(1255, 300);

  await a.getByRole('button', { name: /^Share/ }).click();
  await a.getByPlaceholder('name@example.com').fill(emailOf(USER_B));
  await a.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(a.getByText(emailOf(USER_B))).toBeVisible();
  await a.keyboard.press('Escape');

  await openBoard(b, boardUrl);
  // B is on the board for A: the people next to Share are listed by name ("dev2 is on this board" when B is the only
  // one, "On this board: dev1, dev2" with more).
  await expect(
    a.getByRole('list', {
      name: new RegExp(`^${USER_B} is on this board|^On this board: .*${USER_B}`),
    }),
  ).toBeVisible();
});

test('a timer started by one person counts down for the other', async () => {
  await a.getByRole('button', { name: /^Timer/ }).click();
  await a.getByRole('button', { name: 'Start', exact: true }).click();
  await a.mouse.click(1255, 300);

  const countdown = /0[0-5]:\d\d/;
  await expect(a.locator('app-top-bar')).toContainText(countdown);
  await expect(b.locator('app-top-bar')).toContainText(countdown);

  await a.getByRole('button', { name: 'Stop the timer' }).click();
  await expect(b.getByRole('button', { name: 'Stop the timer' })).toHaveCount(0);
});

test('a dot voting ends by itself when both people have voted, and shows the same result to both', async () => {
  await a.getByRole('button', { name: /^Voting/ }).click();
  await a.getByRole('button', { name: '3', exact: true }).click();
  await a.getByRole('textbox').last().fill('1');
  await a.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(b.getByRole('button', { name: /^Voting/ })).toContainText('1 left');

  await a.mouse.click(FIRST_NOTE.x, FIRST_NOTE.y);
  await b.mouse.click(FIRST_NOTE.x, FIRST_NOTE.y);

  for (const page of [a, b]) {
    const results = page.getByRole('dialog', { name: /^Results/ });
    await expect(results).toContainText(NOTE_TEXT);
    await expect(results).toContainText('2 votes in total');
  }
});

test('a viewer sees the board but has no timer and no voting', async () => {
  await a.getByRole('button', { name: /^Share/ }).click();
  // The first select is the form's role, then one per member: A (the owner) and B.
  await a.getByRole('combobox').nth(2).selectOption('Viewer');
  await a.keyboard.press('Escape');

  await b.reload();
  await expect(b.getByText('Connected', { exact: true })).toBeVisible();
  await expect(b.getByRole('button', { name: /^Timer/ })).toHaveCount(0);
  await expect(b.getByRole('button', { name: /^Start|^Voting/ })).toHaveCount(0);
  // The results of the voting that ended are still there to read.
  await expect(b.getByRole('button', { name: /^Results/ })).toBeVisible();
});
