import { AxeBuilder } from '@axe-core/playwright';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { type Browser, type BrowserContextOptions, type Page, expect } from '@playwright/test';

export const USER_A = process.env.E2E_USER_A ?? 'dev1';
export const USER_B = process.env.E2E_USER_B ?? 'dev2';

/** The demo users' e-mail addresses follow their names (infra/keycloak/realm-elysion.json). */
export const emailOf = (user: string) => `${user}@elysion.local`;

/** Logs a demo user in through Keycloak (the password is the username) in a browser context of its own. */
export async function login(
  browser: Browser,
  user: string,
  options?: BrowserContextOptions,
): Promise<Page> {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await page.goto('/');
  await page.fill('#username', user);
  await page.fill('#password', user);
  await page.click('#kc-login');
  await expect(page.getByRole('button', { name: user, exact: true })).toBeVisible();
  return page;
}

/** Opens a board and waits until the realtime connection is up. */
export async function openBoard(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  // The canvas draws its first frame and the view settles.
  await page.waitForTimeout(1500);
}

/** The board list, with its first load done. */
export async function openBoardList(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole('navigation', { name: 'Rooms' })).toBeVisible();
}

/** Makes a board from the board list (in the room whose view is open, if any) and waits until it is open; returns its URL. */
export async function createBoard(page: Page, name: string, template?: string): Promise<string> {
  await page
    .getByRole('button', { name: /New board/ })
    .first()
    .click();
  await page.getByRole('textbox', { name: 'Board name' }).fill(name);
  if (template) await page.getByText(template, { exact: true }).click();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/board\/[0-9a-f-]+$/);
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  return page.url();
}

/** Deletes a board of the list by its name (the page shows the list that holds it); one of them if there are several. */
export async function deleteBoard(page: Page, name: string): Promise<void> {
  const cards = page.getByText(name, { exact: true });
  const before = await cards.count();
  await cards.first().hover();
  await page
    .getByRole('button', { name: `Delete the board ${name}`, exact: true })
    .first()
    .click({ force: true });
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(cards).toHaveCount(before - 1);
}

/** Deletes every board of the list with this name. */
export async function deleteBoardsNamed(page: Page, name: string): Promise<void> {
  while (await page.getByText(name, { exact: true }).count()) await deleteBoard(page, name);
}

/** The card of a board in the list. */
export const boardCard = (page: Page, name: string) =>
  page.getByRole('link', { name: new RegExp(name) }).first();

/** The elements on the board, read from the board's own Excalidraw export (what the canvas element offers). */
export interface BoardElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  backgroundColor: string;
  text?: string;
  points?: [number, number][];
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
}

export async function boardElements(page: Page): Promise<BoardElement[]> {
  const text = await page.evaluate(async () => {
    const canvas = document.querySelector('elysion-canvas') as HTMLElement & {
      exportBoard(format: string): Promise<Blob | null>;
    };
    const blob = await canvas.exportBoard('excalidraw');
    return blob ? await blob.text() : '{"elements":[]}';
  });
  return (JSON.parse(text) as { elements: BoardElement[] }).elements;
}

export const elementCount = async (page: Page) => (await boardElements(page)).length;

/** Whether the tests may run `docker compose` against the stack (not where the stack is somebody else's: `E2E_NO_COMPOSE`). */
export const canUseCompose = !process.env.E2E_NO_COMPOSE;

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Runs `docker compose <args>` in the repository root, with extra environment variables for the call. */
export async function compose(args: string[], env: Record<string, string> = {}): Promise<void> {
  await promisify(execFile)('docker', ['compose', ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
  });
}

/** Waits until the API answers (an anonymous request is refused with a 4xx) after a service was started again. */
export async function waitForApi(): Promise<void> {
  const base = process.env.E2E_BASE_URL ?? 'http://localhost';
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`${base}/api/boards`)).status;
        } catch {
          return 0;
        }
      },
      { timeout: 60_000 },
    )
    .toBe(401);
}

/**
 * The places Excalidraw owns and Elysion does not control: its canvases (a drawing has no text alternative) and the hidden
 * inputs behind its tool buttons (they have no label of their own). The list is the allowlist of docs/specs/frontend.md, "Accessibility".
 */
export const AXE_ALLOWLIST = ['.excalidraw canvas', '.excalidraw input[aria-keyshortcuts]'];

/** Fails when the page has a violation of the WCAG 2.1 A or AA rules outside the allowlist; `where` names the state in the message. */
export async function expectAccessible(page: Page, where: string): Promise<void> {
  // One `exclude` per entry: a list in one call would be read as a path through shadow roots.
  const builder = AXE_ALLOWLIST.reduce(
    (axe, selector) => axe.exclude(selector),
    new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']),
  );
  const results = await builder.analyze();
  const found = results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact}): ${violation.help}\n${violation.nodes
        .slice(0, 4)
        .map((node) => {
          const data = node.any[0]?.data as
            { fgColor?: string; bgColor?: string; contrastRatio?: number } | undefined;
          const colors = data?.fgColor
            ? ` (${data.fgColor} on ${data.bgColor}, ${data.contrastRatio})`
            : '';
          return `    ${node.target.join(' ')}${colors}`;
        })
        .join('\n')}`,
  );
  expect.soft(found, `accessibility violations: ${where}`).toEqual([]);
}
