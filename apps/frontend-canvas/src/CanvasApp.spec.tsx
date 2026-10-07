import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasApp } from './CanvasApp';
import { STICKY_COLORS, paperColor } from './sticky-note';
import { excalidrawReady } from './test-utils';

/** Excalidraw's own theme shortcut, Alt+Shift+D; it listens on its container, once it has loaded. */
async function switchThemeWithShortcut(container: HTMLElement) {
  await excalidrawReady(container);
  fireEvent.keyDown(container.querySelector('.excalidraw') as HTMLElement, {
    key: 'D',
    code: 'KeyD',
    altKey: true,
    shiftKey: true,
  });
}

describe('CanvasApp', () => {
  beforeEach(() => localStorage.clear()); // the sticky color and the grid are kept per browser
  it('renders the Excalidraw canvas', async () => {
    render(<CanvasApp boardId="test-board" />);

    expect(await screen.findByTestId('toolbar-rectangle')).toBeTruthy();
  });

  it('scopes the ariadne tokens to the canvas root and applies an explicit theme', async () => {
    const { container } = render(<CanvasApp boardId="test-board" theme="dark" />);
    await screen.findByTestId('toolbar-rectangle');

    const root = container.querySelector('.elysion-canvas');
    expect(root?.getAttribute('data-theme')).toBe('dark');
    expect(root?.querySelector('.excalidraw.theme--dark')).toBeTruthy();
  });

  it('defaults to the light theme when the system has no dark preference', async () => {
    const { container } = render(<CanvasApp boardId="test-board" />);
    await screen.findByTestId('toolbar-rectangle');

    expect(container.querySelector('.elysion-canvas')?.getAttribute('data-theme')).toBe('light');
  });

  it("keeps Excalidraw's theme shortcut (Alt+Shift+D) and the tokens follow it", async () => {
    const { container } = render(<CanvasApp boardId="test-board" theme="light" />);
    await screen.findByTestId('toolbar-rectangle');

    await switchThemeWithShortcut(container);

    await waitFor(() =>
      expect(container.querySelector('.elysion-canvas')?.getAttribute('data-theme')).toBe('dark'),
    );
    expect(container.querySelector('.excalidraw.theme--dark')).toBeTruthy();
  });

  it('reports a theme switched inside the canvas, but not one the host set', async () => {
    const onThemeChange = vi.fn();
    const { container, rerender } = render(
      <CanvasApp boardId="test-board" theme="light" onThemeChange={onThemeChange} />,
    );
    await screen.findByTestId('toolbar-rectangle');
    expect(onThemeChange).not.toHaveBeenCalled();

    // The host changes the attribute: the canvas follows, and nobody needs to be told.
    rerender(<CanvasApp boardId="test-board" theme="dark" onThemeChange={onThemeChange} />);
    await waitFor(() =>
      expect(container.querySelector('.elysion-canvas')?.getAttribute('data-theme')).toBe('dark'),
    );
    expect(onThemeChange).not.toHaveBeenCalled();

    // The user switches it with Excalidraw's own toggle.
    await switchThemeWithShortcut(container);

    await waitFor(() => expect(onThemeChange).toHaveBeenCalledWith('light'));
    expect(onThemeChange).toHaveBeenCalledTimes(1);
  });

  it('reports the connection status, starting with connecting', async () => {
    const onStatusChange = vi.fn();
    render(<CanvasApp boardId="test-board" onStatusChange={onStatusChange} />);
    await screen.findByTestId('toolbar-rectangle');

    expect(onStatusChange).toHaveBeenCalledWith('connecting');
  });

  it('hands the host controls once, and they open and close the library sidebar', async () => {
    const onControls = vi.fn();
    const onLibraryChange = vi.fn();
    render(
      <CanvasApp boardId="test-board" onControls={onControls} onLibraryChange={onLibraryChange} />,
    );
    await screen.findByTestId('toolbar-rectangle');

    expect(onControls).toHaveBeenCalledTimes(1);
    const { toggleLibrary } = onControls.mock.calls[0][0];
    expect(onLibraryChange).not.toHaveBeenCalled();

    act(() => toggleLibrary());
    await waitFor(() => expect(onLibraryChange).toHaveBeenLastCalledWith(true));

    act(() => toggleLibrary());
    await waitFor(() => expect(onLibraryChange).toHaveBeenLastCalledWith(false));
    expect(onLibraryChange).toHaveBeenCalledTimes(2);
  });

  it("does not show Excalidraw's own floating Library button", async () => {
    const { container } = render(<CanvasApp boardId="test-board" />);
    await screen.findByTestId('toolbar-rectangle');

    // Our hidden trigger takes the place of Excalidraw's fallback; its label wrapper stays empty.
    const triggers = [...container.querySelectorAll('.default-sidebar-trigger')];
    expect(triggers).toHaveLength(1);
    expect(getComputedStyle(triggers[0]).display).toBe('none');
    for (const label of container.querySelectorAll('.sidebar-trigger__label-element')) {
      expect(label.textContent).toBe('');
    }
  });

  it("hides Excalidraw's hamburger: the menu is in the toolbar", async () => {
    render(<CanvasApp boardId="test-board" />);
    await screen.findByTestId('toolbar-rectangle');

    // Excalidraw's own stylesheet is not applied in the test, so the rule that hides its trigger is checked as written.
    const css = readFileSync(join(process.cwd(), 'src/styles/toolbar.css'), 'utf8');
    expect(css).toMatch(/\.main-menu-trigger\s*\{\s*display:\s*none;/);
    expect(screen.getByRole('button', { name: 'Canvas menu' })).toBeTruthy();
  });

  it('exports a real sticky note and takes the file back in', async () => {
    const onControls = vi.fn();
    render(<CanvasApp boardId="test-board" onControls={onControls} />);
    await screen.findByTestId('toolbar-rectangle');
    const controls = onControls.mock.calls[0][0];

    expect(await controls.exportBoard('excalidraw')).toBeNull(); // nothing on the board yet

    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' })); // one click: a note in the current color

    const file = (await controls.exportBoard('excalidraw')) as Blob;
    const ids = (JSON.parse(await file.text()).elements as { id: string }[]).map((e) => e.id);
    expect(ids).toHaveLength(2); // the card and its text

    expect(await controls.importFile(file)).toBe(2);
    const again = JSON.parse(await ((await controls.exportBoard('excalidraw')) as Blob).text());
    expect(again.elements.map((e: { id: string }) => e.id).sort()).toEqual([...ids].sort());
  });

  it('inserts a template next to what is on the board, keeping it, as one undoable step', async () => {
    const onControls = vi.fn();
    render(<CanvasApp boardId="test-board" onControls={onControls} />);
    await screen.findByTestId('toolbar-rectangle');
    const controls = onControls.mock.calls[0][0];
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' })); // one click: a note in the current color
    const file = (await controls.exportBoard('excalidraw')) as Blob;
    const ids = async () =>
      (
        JSON.parse(await ((await controls.exportBoard('excalidraw')) as Blob).text()).elements as {
          id: string;
        }[]
      ).map((e) => e.id);
    const before = await ids();

    expect(await controls.insertFile(file)).toBe(2);

    const after = await ids();
    expect(after).toHaveLength(4);
    expect(after.filter((id) => !before.includes(id))).toHaveLength(2);
    expect(before.every((id) => after.includes(id))).toBe(true);

    fireEvent.click(screen.getByTestId('elysion-undo'));
    await waitFor(async () => expect(await ids()).toEqual(before));
  });

  it('zooms from the toolbar in steps of 10% and resets to 100%', async () => {
    render(<CanvasApp boardId="test-board" />);
    await screen.findByTestId('toolbar-rectangle');
    const level = () => screen.getByTestId('elysion-zoom-reset').textContent;
    expect(level()).toBe('100%');

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    await waitFor(() => expect(level()).toBe('110%'));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    await waitFor(() => expect(level()).toBe('120%'));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    await waitFor(() => expect(level()).toBe('110%'));

    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom to 100%' }));
    await waitFor(() => expect(level()).toBe('100%'));
  });

  it('does not zoom out below 10%', async () => {
    render(<CanvasApp boardId="test-board" />);
    await screen.findByTestId('toolbar-rectangle');

    for (let i = 0; i < 12; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    }

    await waitFor(() => expect(screen.getByTestId('elysion-zoom-reset').textContent).toBe('10%'));
  });

  it('fits an empty board back to 100%', async () => {
    render(<CanvasApp boardId="test-board" />);
    await screen.findByTestId('toolbar-rectangle');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    await waitFor(() => expect(screen.getByTestId('elysion-zoom-reset').textContent).toBe('110%'));

    fireEvent.click(screen.getByRole('button', { name: 'Zoom to fit' }));

    await waitFor(() => expect(screen.getByTestId('elysion-zoom-reset').textContent).toBe('100%'));
  });

  it('undoes and redoes through the toolbar, the way the keyboard shortcut does', async () => {
    const onControls = vi.fn();
    const { container } = render(<CanvasApp boardId="test-board" onControls={onControls} />);
    await screen.findByTestId('toolbar-rectangle');
    await excalidrawReady(container);
    const controls = onControls.mock.calls[0][0];

    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' })); // one click: a note in the current color
    expect(await controls.exportBoard('excalidraw')).not.toBeNull();

    // By test id: Excalidraw's own (CSS-hidden) Undo is in the DOM too, which jsdom does not hide.
    fireEvent.click(screen.getByTestId('elysion-undo'));
    await waitFor(async () => expect(await controls.exportBoard('excalidraw')).toBeNull());

    fireEvent.click(screen.getByTestId('elysion-redo'));
    await waitFor(async () => expect(await controls.exportBoard('excalidraw')).not.toBeNull());
  });
});

describe('the canvas menu', () => {
  const draw = (canvas: Element) => {
    const init = (x: number, y: number, buttons = 1) => ({
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      buttons,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
    fireEvent.pointerDown(canvas, init(100, 100));
    fireEvent.pointerMove(canvas, init(180, 150));
    fireEvent.pointerMove(canvas, init(260, 200));
    fireEvent.pointerUp(canvas, init(260, 200, 0));
  };

  it('opens Excalidraw’s help dialog with Help', async () => {
    const { container } = render(<CanvasApp boardId="test-board" />);
    await excalidrawReady(container);

    fireEvent.click(screen.getByRole('button', { name: 'Canvas menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Help/ }));

    // The dialog is a portal outside the canvas, and takes the focus.
    await waitFor(() => expect(document.querySelector('.HelpDialog__btn')).toBeTruthy(), {
      timeout: 3000,
    });
  }, 20000);

  it('clears the board only after the question, as tombstones, and one undo brings it back', async () => {
    const onControls = vi.fn();
    const { container } = render(<CanvasApp boardId="test-board" onControls={onControls} />);
    await excalidrawReady(container);
    const controls = onControls.mock.calls[0][0];
    draw(container.querySelector('canvas.interactive')!);
    // An empty board exports as nothing: `null` counts as no live element.
    const live = async () => {
      const blob = (await controls.exportBoard('excalidraw')) as Blob | null;
      if (!blob) return 0;
      return (JSON.parse(await blob.text()).elements as { isDeleted?: boolean }[]).filter(
        (e) => !e.isDeleted,
      ).length;
    };
    await waitFor(async () => expect(await live()).toBe(1));

    fireEvent.click(screen.getByRole('button', { name: 'Canvas menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Clear canvas/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(await live()).toBe(1); // declined: nothing happened

    fireEvent.click(screen.getByRole('menuitem', { name: /Clear canvas/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear everything' }));
    await waitFor(async () => expect(await live()).toBe(0));

    fireEvent.click(
      within(screen.getByRole('toolbar', { name: 'Canvas tools' })).getByRole('button', {
        name: 'Undo',
      }),
    );
    await waitFor(async () => expect(await live()).toBe(1));
  });

  it('gives a viewer Help but no Clear canvas', async () => {
    const { container } = render(<CanvasApp boardId="test-board" readOnly />);
    await excalidrawReady(container);

    fireEvent.click(screen.getByRole('button', { name: 'Canvas menu' }));

    expect(screen.getByRole('menuitem', { name: /Help/ })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /Clear canvas/ })).toBeNull();
  });
});

describe('the grid', () => {
  const GRID_KEYS_ALL = ['elysion.grid.show', 'elysion.grid.snap', 'elysion.grid.size'];
  const forget = () => GRID_KEYS_ALL.forEach((key) => localStorage.removeItem(key));

  /** Draws a rectangle with the real tool between two points (jsdom has no layout: client = canvas coordinates). */
  const draw = (canvas: Element, from: [number, number], to: [number, number]) => {
    const init = (point: [number, number], buttons = 1) => ({
      clientX: point[0],
      clientY: point[1],
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      buttons,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
    fireEvent.pointerDown(canvas, init(from));
    fireEvent.pointerMove(canvas, init([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]));
    fireEvent.pointerMove(canvas, init(to));
    fireEvent.pointerUp(canvas, init(to, 0));
  };
  const open = () => fireEvent.click(screen.getByRole('button', { name: 'Canvas menu' }));

  /** The scene as exported, with the app state's grid values, and the first rectangle. */
  async function exported(controls: { exportBoard(format: string): Promise<Blob | null> }) {
    const blob = (await controls.exportBoard('excalidraw')) as Blob;
    const file = JSON.parse(await blob.text());
    return {
      grid: file.appState as { gridModeEnabled: boolean; gridSize: number },
      rectangle: file.elements.find((e: { type: string }) => e.type === 'rectangle') as {
        x: number;
        y: number;
      },
    };
  }

  async function setup(props: { readOnly?: boolean } = {}) {
    forget();
    const onControls = vi.fn();
    const { container } = render(
      <CanvasApp boardId="test-board" onControls={onControls} {...props} />,
    );
    await excalidrawReady(container);
    return {
      container,
      controls: onControls.mock.calls[0][0],
      canvas: container.querySelector('canvas.interactive')!,
    };
  }

  it('offers Show grid, Snap to grid and the sizes, starting with the grid hidden and 20 px', async () => {
    await setup();

    open();

    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Show grid' }).getAttribute('aria-checked'),
    ).toBe('false');
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Snap to grid' }).getAttribute('aria-checked'),
    ).toBe('false');
    expect(
      ['10 px', '20 px', '40 px'].map((name) =>
        screen.getByRole('menuitemradio', { name }).getAttribute('aria-checked'),
      ),
    ).toEqual(['false', 'true', 'false']);
  });

  it('shows the grid at the chosen size, remembers it, and a reload starts with it', async () => {
    const { controls, canvas } = await setup();
    draw(canvas, [100, 100], [260, 200]); // an empty board exports as nothing

    open();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Show grid' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: '40 px' }));

    await waitFor(async () =>
      expect((await exported(controls)).grid).toMatchObject({
        gridModeEnabled: true,
        gridSize: 40,
      }),
    );
    expect(localStorage.getItem('elysion.grid.show')).toBe('true');
    expect(localStorage.getItem('elysion.grid.size')).toBe('40');
    // The menu stays open for a size (to try them), and a shown grid is always snapped to: the switch is on and disabled.
    const snap = screen.getByRole('menuitemcheckbox', { name: 'Snap to grid' });
    expect(snap.getAttribute('aria-checked')).toBe('true');
    expect(snap.getAttribute('aria-disabled')).toBe('true');

    cleanup();
    const again = render(<CanvasApp boardId="test-board" onControls={vi.fn()} />);
    await excalidrawReady(again.container);
    open();
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Show grid' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(screen.getByRole('menuitemradio', { name: '40 px' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  }, 20000);

  it('snaps a new rectangle to the grid while Snap to grid is on, and not without it', async () => {
    const { controls, canvas } = await setup();

    draw(canvas, [103, 107], [258, 203]);
    await waitFor(async () => expect((await exported(controls)).rectangle.x).toBe(103));

    open();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Snap to grid' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    draw(canvas, [413, 337], [578, 453]);

    await waitFor(async () => {
      const scene = JSON.parse(await ((await controls.exportBoard('excalidraw')) as Blob).text())
        .elements as {
        type: string;
        x: number;
        y: number;
      }[];
      const second = scene.filter((e) => e.type === 'rectangle')[1];
      expect(second.x % 20).toBe(0);
      expect(second.y % 20).toBe(0);
    });
  }, 20000);

  it('gives a viewer Show grid and the sizes, but no Snap to grid', async () => {
    await setup({ readOnly: true });

    open();

    expect(screen.getByRole('menuitemcheckbox', { name: 'Show grid' })).toBeTruthy();
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Snap to grid' })).toBeNull();
    expect(screen.getByRole('menuitemradio', { name: '20 px' })).toBeTruthy();
  });
});

describe('sticky notes made with one click', () => {
  beforeEach(() => localStorage.clear());

  /** The notes of the board: the rectangles that carry a bound text, with their colors. */
  async function notes(controls: { exportBoard(format: string): Promise<Blob | null> }) {
    const blob = await controls.exportBoard('excalidraw');
    if (!blob) return [];
    const elements = JSON.parse(await blob.text()).elements as {
      type: string;
      backgroundColor: string;
      boundElements: { type: string }[] | null;
    }[];
    return elements
      .filter((e) => e.type === 'rectangle' && e.boundElements?.some((b) => b.type === 'text'))
      .map((e) => e.backgroundColor);
  }

  async function setup() {
    const onControls = vi.fn();
    const { container } = render(<CanvasApp boardId="test-board" onControls={onControls} />);
    await excalidrawReady(container);
    return { container, controls: onControls.mock.calls[0][0] };
  }

  it('makes a yellow note with the first click, a note in the chosen color after choosing, and then that color again', async () => {
    const { controls } = await setup();
    const sticky = () => fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));

    sticky();
    await waitFor(async () =>
      expect(await notes(controls)).toEqual([paperColor(STICKY_COLORS[0])]),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sticky note color' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Teal sticky note' }));
    sticky();

    await waitFor(async () =>
      expect(await notes(controls)).toEqual([
        paperColor(STICKY_COLORS[0]),
        paperColor(STICKY_COLORS[6]),
        paperColor(STICKY_COLORS[6]),
      ]),
    );
    expect(localStorage.getItem('elysion.sticky.color')).toBe('Teal');
  }, 20000);

  it('shows the colors as note icons with the current one checked, and starts with the stored color after a reload', async () => {
    localStorage.setItem('elysion.sticky.color', 'Pink');
    await setup();

    fireEvent.click(screen.getByRole('button', { name: 'Sticky note color' }));

    const items = screen.getAllByRole('menuitemradio');
    expect(items).toHaveLength(STICKY_COLORS.length);
    expect(items.every((item) => item.querySelector('svg path'))).toBe(true); // a note icon, not a plain circle
    expect(
      items
        .find((item) => item.getAttribute('aria-checked') === 'true')
        ?.getAttribute('aria-label'),
    ).toBe('Pink sticky note');
  });

  it('makes a note with the key N, in the current color, and not while typing in a field', async () => {
    const { controls } = await setup();
    const input = document.createElement('input');
    document.body.appendChild(input);

    fireEvent.keyDown(input, { key: 'n' });
    fireEvent.keyDown(window, { key: 'n', ctrlKey: true });
    expect(await notes(controls)).toEqual([]);

    fireEvent.keyDown(window, { key: 'n' });
    await waitFor(async () => expect(await notes(controls)).toHaveLength(1));
    input.remove();
  });

  it('has no sticky button for a viewer, and N makes nothing there', async () => {
    const onControls = vi.fn();
    const { container } = render(
      <CanvasApp boardId="test-board" onControls={onControls} readOnly />,
    );
    await excalidrawReady(container);

    fireEvent.keyDown(window, { key: 'n' });

    expect(screen.queryByRole('button', { name: 'Sticky note' })).toBeNull();
    expect(await notes(onControls.mock.calls[0][0])).toEqual([]);
  });
});
