import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasApp } from './CanvasApp';
import { Toolbar } from './Toolbar';

describe('Toolbar', () => {
  it('is an accessible toolbar with a labelled, titled button per tool', () => {
    render(<Toolbar activeTool="selection" onSelect={() => {}} />);

    expect(screen.getByRole('toolbar', { name: 'Canvas tools' })).toBeTruthy();
    const rectangle = screen.getByRole('button', { name: 'Rectangle' });
    expect(rectangle.getAttribute('title')).toBe('Rectangle (R)');
  });

  it('marks only the active tool as pressed', () => {
    render(<Toolbar activeTool="ellipse" onSelect={() => {}} />);

    expect(screen.getByRole('button', { name: 'Ellipse' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Rectangle' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('reports the clicked tool', () => {
    const onSelect = vi.fn();
    render(<Toolbar activeTool="selection" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: 'Diamond' }));
    expect(onSelect).toHaveBeenCalledWith('diamond');
  });
});

describe('Toolbar inside CanvasApp', () => {
  it('switches the Excalidraw tool on click and stays in sync with keyboard shortcuts', async () => {
    const { container } = render(<CanvasApp boardId="test-board" />);
    const pressed = (name: string) =>
      screen.getByRole('button', { name }).getAttribute('aria-pressed');

    await waitFor(() => expect(screen.getByRole('button', { name: 'Selection' })).toBeTruthy());
    await waitFor(() => expect(pressed('Selection')).toBe('true'));

    fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
    await waitFor(() => expect(pressed('Rectangle')).toBe('true'));
    expect(pressed('Selection')).toBe('false');

    // Excalidraw's own shortcut changes the tool; the toolbar must follow.
    // Without `handleKeyboardGlobally` Excalidraw listens on its own container.
    const excalidraw = container.querySelector('.excalidraw') as HTMLElement;
    fireEvent.keyDown(excalidraw, { key: 'e', code: 'KeyE' });
    await waitFor(() => expect(pressed('Eraser')).toBe('true'));
    expect(pressed('Rectangle')).toBe('false');
  });
});
