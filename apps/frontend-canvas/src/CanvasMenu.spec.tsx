import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasMenu, type CanvasMenuItem } from './CanvasMenu';

const open = () => fireEvent.click(screen.getByRole('button', { name: 'Canvas menu' }));

describe('CanvasMenu', () => {
  it('is closed until the button is pressed, and says so for assistive technology', () => {
    render(<CanvasMenu items={[{ type: 'item', id: 'a', label: 'Alpha', onSelect: () => {} }]} />);
    const button = screen.getByRole('button', { name: 'Canvas menu' });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');

    open();
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('runs an item and closes', () => {
    const onSelect = vi.fn();
    render(<CanvasMenu items={[{ type: 'item', id: 'a', label: 'Alpha', onSelect }]} />);
    open();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Alpha' }));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape and returns the focus to the button, and on a click outside', async () => {
    render(
      <div>
        <span data-testid="outside">outside</span>
        <CanvasMenu items={[{ type: 'item', id: 'a', label: 'Alpha', onSelect: () => {} }]} />
      </div>,
    );
    open();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitem')));

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Canvas menu' }));

    open();
    fireEvent.pointerDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('moves between items with the arrow keys, wrapping around, and Home and End', async () => {
    const items: CanvasMenuItem[] = ['A', 'B', 'C'].map((label) => ({
      type: 'item',
      id: label,
      label,
      onSelect: () => {},
    }));
    render(<CanvasMenu items={items} />);
    open();
    const names = () => (document.activeElement as HTMLElement).textContent;
    await waitFor(() => expect(names()).toBe('A'));

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(names()).toBe('B');
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' });
    expect(names()).toBe('C');
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(names()).toBe('A');
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' });
    expect(names()).toBe('C');
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Home' });
    expect(names()).toBe('A');
  });

  it('asks before an item that needs a confirmation, and does nothing when declined', () => {
    const onSelect = vi.fn();
    render(
      <CanvasMenu
        items={[
          {
            type: 'item',
            id: 'clear',
            label: 'Clear',
            onSelect,
            confirm: { message: 'Sure?', accept: 'Yes, clear', decline: 'Keep it' },
          },
        ]}
      />,
    );
    open();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear' }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByText('Sure?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('menuitem', { name: 'Clear' })).toBeTruthy(); // back to the list

    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, clear' }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('shows check and radio items with their state, and a radio item can keep the menu open', () => {
    const onSelect = vi.fn();
    render(
      <CanvasMenu
        items={[
          { type: 'heading', label: 'View' },
          { type: 'check', id: 'c', label: 'Show', checked: true, onSelect: () => {} },
          { type: 'radio', id: 'r', label: '20 px', checked: true, onSelect, keepOpen: true },
          { type: 'radio', id: 's', label: '40 px', checked: false, onSelect: () => {} },
        ]}
      />,
    );
    open();

    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Show' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(screen.getByRole('menuitemradio', { name: '40 px' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    fireEvent.click(screen.getByRole('menuitemradio', { name: '20 px' }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('does not act on a disabled item', () => {
    const onSelect = vi.fn();
    render(
      <CanvasMenu
        items={[{ type: 'check', id: 'c', label: 'Snap', checked: true, onSelect, disabled: true }]}
      />,
    );
    open();

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Snap' }));

    expect(onSelect).not.toHaveBeenCalled();
  });
});
