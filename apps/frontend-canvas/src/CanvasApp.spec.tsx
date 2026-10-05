import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasApp } from './CanvasApp';
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

  it('keeps only Clear canvas and Help in the main menu: the rest is in the top bar', async () => {
    render(<CanvasApp boardId="test-board" />);
    await screen.findByTestId('toolbar-rectangle');

    fireEvent.click(await screen.findByTestId('main-menu-trigger'));

    expect(await screen.findByText('Reset the canvas')).toBeTruthy();
    expect(screen.getByText('Help')).toBeTruthy();
    for (const gone of ['Open', 'Save to...', 'Export image...', 'Dark mode', 'Light mode']) {
      expect(screen.queryByText(gone)).toBeNull();
    }
  });

  it('exports a real sticky note and takes the file back in', async () => {
    const onControls = vi.fn();
    render(<CanvasApp boardId="test-board" onControls={onControls} />);
    await screen.findByTestId('toolbar-rectangle');
    const controls = onControls.mock.calls[0][0];

    expect(await controls.exportBoard('excalidraw')).toBeNull(); // nothing on the board yet

    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    fireEvent.click(screen.getByRole('button', { name: 'Amber sticky note' }));

    const file = (await controls.exportBoard('excalidraw')) as Blob;
    const ids = (JSON.parse(await file.text()).elements as { id: string }[]).map((e) => e.id);
    expect(ids).toHaveLength(2); // the card and its text

    expect(await controls.importFile(file)).toBe(2);
    const again = JSON.parse(await ((await controls.exportBoard('excalidraw')) as Blob).text());
    expect(again.elements.map((e: { id: string }) => e.id).sort()).toEqual([...ids].sort());
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

    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    fireEvent.click(screen.getByRole('button', { name: 'Amber sticky note' }));
    expect(await controls.exportBoard('excalidraw')).not.toBeNull();

    // By test id: Excalidraw's own (CSS-hidden) Undo is in the DOM too, which jsdom does not hide.
    fireEvent.click(screen.getByTestId('elysion-undo'));
    await waitFor(async () => expect(await controls.exportBoard('excalidraw')).toBeNull());

    fireEvent.click(screen.getByTestId('elysion-redo'));
    await waitFor(async () => expect(await controls.exportBoard('excalidraw')).not.toBeNull());
  });
});
