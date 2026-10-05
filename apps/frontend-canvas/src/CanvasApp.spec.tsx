import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
});
