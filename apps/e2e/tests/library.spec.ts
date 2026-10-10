import { type Page, expect, test } from '@playwright/test';
import { USER_A, createBoard, deleteBoardsNamed, login, openBoardList } from './helpers.js';

/**
 * The Excalidraw library (#770): "Browse libraries" sends the user to the library site, which opens the app again in a new
 * tab with `#addLibrary=<url>&token=<id>`; the canvas has to take the library up (after the user confirms) and keep it. The
 * library site is stubbed: the test is about what the app does with the address, not about the third party being up.
 */
const BOARD = 'E2E library';
const LIBRARY_URL = 'https://libraries.excalidraw.com/libraries/elysion/e2e.excalidrawlib';
const STORAGE_KEY = 'elysion:library';

const LIBRARY = {
  type: 'excalidrawlib',
  version: 2,
  source: 'e2e',
  libraryItems: [
    {
      id: 'e2e-item',
      status: 'published',
      created: 1,
      name: 'A box',
      elements: [
        {
          id: 'box',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 80,
          height: 40,
          angle: 0,
          strokeColor: '#1e1e1e',
          backgroundColor: 'transparent',
          fillStyle: 'solid',
          strokeWidth: 2,
          strokeStyle: 'solid',
          roughness: 0,
          opacity: 100,
          groupIds: [],
          frameId: null,
          roundness: null,
          seed: 1,
          version: 1,
          versionNonce: 1,
          isDeleted: false,
          boundElements: null,
          updated: 1,
          link: null,
          locked: false,
        },
      ],
    },
  ],
};

const savedItems = (page: Page) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? '[]').length as number,
    STORAGE_KEY,
  );

test('a library chosen on the library site is added after the confirmation, and is still there after a reload', async ({
  browser,
}) => {
  const a = await login(browser, USER_A);
  let tab: Page | undefined;
  try {
    await openBoardList(a);
    const boardUrl = await createBoard(a, BOARD);

    await a.context().route(LIBRARY_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(LIBRARY),
      }),
    );

    // The library site opens the app in a new tab, which has to sign in again (silently: the identity provider's cookie).
    tab = await a.context().newPage();
    const prompts: string[] = [];
    tab.on('dialog', (dialog) => {
      prompts.push(dialog.message());
      void dialog.accept();
    });
    await tab.goto(`${boardUrl}#addLibrary=${encodeURIComponent(LIBRARY_URL)}&token=not-this-tab`);

    await expect.poll(() => savedItems(tab!), { timeout: 30_000 }).toBe(1);
    expect(prompts).toHaveLength(1);
    // The address is cleaned, so a reload does not add it again.
    await expect.poll(() => tab!.evaluate(() => location.hash)).not.toContain('addLibrary');
    await tab.reload();
    await expect(tab.getByRole('button', { name: 'Library', exact: true })).toBeVisible();
    await tab.getByRole('button', { name: 'Library', exact: true }).click();
    // The saved library is loaded into the canvas again: its item is in the sidebar.
    await expect(tab.locator('.library-unit')).toHaveCount(1);
    expect(await savedItems(tab)).toBe(1);
  } finally {
    await tab?.close();
    await openBoardList(a);
    await deleteBoardsNamed(a, BOARD);
    await a.context().close();
  }
});
