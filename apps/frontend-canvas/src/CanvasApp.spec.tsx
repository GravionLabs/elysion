import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasApp } from './CanvasApp';

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

  it("offers Excalidraw's theme toggle in the main menu and the tokens follow it", async () => {
    const { container } = render(<CanvasApp boardId="test-board" theme="light" />);
    await screen.findByTestId('toolbar-rectangle');

    fireEvent.click(await screen.findByTestId('main-menu-trigger'));
    fireEvent.click(await screen.findByText('Dark mode'));

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
    fireEvent.click(await screen.findByTestId('main-menu-trigger'));
    fireEvent.click(await screen.findByText('Light mode'));

    await waitFor(() => expect(onThemeChange).toHaveBeenCalledWith('light'));
    expect(onThemeChange).toHaveBeenCalledTimes(1);
  });

  it('reports the connection status, starting with connecting', async () => {
    const onStatusChange = vi.fn();
    render(<CanvasApp boardId="test-board" onStatusChange={onStatusChange} />);
    await screen.findByTestId('toolbar-rectangle');

    expect(onStatusChange).toHaveBeenCalledWith('connecting');
  });
});
