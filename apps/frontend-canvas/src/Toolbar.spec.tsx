import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasApp } from './CanvasApp';
import { Toolbar } from './Toolbar';
import { STICKY_COLORS, paperColor, seenColor } from './sticky-note';
import { excalidrawReady } from './test-utils';

describe('Toolbar', () => {
  it('is an accessible toolbar with a labelled, titled button per tool', () => {
    render(<Toolbar activeTool="selection" onSelect={() => {}} />);

    expect(screen.getByRole('toolbar', { name: 'Canvas tools' })).toBeTruthy();
    const rectangle = screen.getByRole('button', { name: 'Rectangle' });
    expect(rectangle.getAttribute('title')).toBe('Rectangle (R)');
  });

  it('calls the arrow tool "Connector", with the shortcut A', () => {
    const onSelect = vi.fn();
    render(<Toolbar activeTool="selection" onSelect={onSelect} />);

    const connector = screen.getByRole('button', { name: 'Connector' });
    expect(connector.getAttribute('title')).toBe('Connector (A)');
    expect(screen.queryByRole('button', { name: 'Arrow' })).toBeNull();
    fireEvent.click(connector);
    expect(onSelect).toHaveBeenCalledWith('arrow'); // the Excalidraw tool id is unchanged
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

describe('Toolbar image tool', () => {
  // Excalidraw's `files` are not shared or stored yet, so an image would be seen by its author only and be gone
  // after a reload: the tool is hidden until the host switches `imagesEnabled` on.
  it('hides the image tool by default and keeps the neighbouring tools', () => {
    render(<Toolbar activeTool="selection" onSelect={() => {}} />);

    expect(screen.queryByRole('button', { name: 'Insert image' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Text' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Eraser' })).toBeTruthy();
  });

  it('offers the image tool when images are enabled', () => {
    const onSelect = vi.fn();
    render(<Toolbar activeTool="selection" onSelect={onSelect} imagesEnabled />);

    const image = screen.getByRole('button', { name: 'Insert image' });
    expect(image.getAttribute('title')).toBe('Insert image (9)');
    fireEvent.click(image);
    expect(onSelect).toHaveBeenCalledWith('image');
  });
});

describe('Toolbar undo, redo and zoom', () => {
  it('shows neither group unless it is given the handlers', () => {
    render(<Toolbar activeTool="selection" onSelect={() => {}} />);

    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Zoom in' })).toBeNull();
  });

  it('reports undo and redo, with the shortcuts in the titles', () => {
    const onHistory = vi.fn();
    render(<Toolbar activeTool="selection" onSelect={() => {}} onHistory={onHistory} />);

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));

    expect(onHistory.mock.calls).toEqual([['undo'], ['redo']]);
    expect(screen.getByRole('button', { name: 'Undo' }).getAttribute('title')).toBe(
      'Undo (Ctrl+Z)',
    );
  });

  it('reports every zoom action and shows the zoom level on the reset button', () => {
    const onZoom = vi.fn();
    render(
      <Toolbar activeTool="selection" onSelect={() => {}} onZoom={onZoom} zoomPercent={125} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom to 100%' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom to fit' }));

    expect(onZoom.mock.calls).toEqual([['out'], ['in'], ['reset'], ['fit']]);
    expect(screen.getByRole('button', { name: 'Reset zoom to 100%' }).textContent).toBe('125%');
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
    await excalidrawReady(container);
    const excalidraw = container.querySelector('.excalidraw') as HTMLElement;
    fireEvent.keyDown(excalidraw, { key: 'e', code: 'KeyE' });
    await waitFor(() => expect(pressed('Eraser')).toBe('true'));
    expect(pressed('Rectangle')).toBe('false');
  });
});

describe('the image tool inside CanvasApp', () => {
  const pressKey9 = async (container: HTMLElement) => {
    await excalidrawReady(container);
    const excalidraw = container.querySelector('.excalidraw') as HTMLElement;
    fireEvent.keyDown(excalidraw, { key: '9', code: 'Digit9' });
  };

  it("ignores Excalidraw's own shortcut for the image tool while images are off", async () => {
    const { container } = render(<CanvasApp boardId="test-board" />);
    const pressed = (name: string) =>
      screen.getByRole('button', { name }).getAttribute('aria-pressed');
    await waitFor(() => expect(pressed('Selection')).toBe('true'));

    await pressKey9(container);

    // The tool is refused (Excalidraw shows its own "Images are disabled" message on an insert), so the
    // selection tool stays the active one.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(pressed('Selection')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Insert image' })).toBeNull();
  });

  it('follows the shortcut to the image tool once images are enabled', async () => {
    const { container } = render(<CanvasApp boardId="test-board" imagesEnabled />);
    const pressed = (name: string) =>
      screen.getByRole('button', { name }).getAttribute('aria-pressed');
    await waitFor(() => expect(pressed('Selection')).toBe('true'));

    await pressKey9(container);

    await waitFor(() => expect(pressed('Insert image')).toBe('true'));
    expect(pressed('Selection')).toBe('false');
  });
});

describe('Toolbar for a viewer (readOnly)', () => {
  const renderViewer = () =>
    render(
      <Toolbar
        activeTool="selection"
        onSelect={() => {}}
        onAddSticky={() => {}}
        onHistory={() => {}}
        onZoom={() => {}}
        zoomPercent={100}
        readOnly
      />,
    );

  it('has no drawing tools, no sticky notes and no undo or redo', () => {
    renderViewer();

    for (const name of ['Rectangle', 'Text', 'Sticky note', 'Undo', 'Redo', 'Eraser']) {
      expect(screen.queryByRole('button', { name: new RegExp(name, 'i') })).toBeNull();
    }
  });

  it('keeps the zoom, so a viewer can still look around', () => {
    renderViewer();

    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Reset zoom/ })).toBeTruthy();
  });
});

describe('the sticky note colors in the toolbar', () => {
  const renderEditor = (theme: 'light' | 'dark') =>
    render(
      <Toolbar
        activeTool="selection"
        onSelect={() => {}}
        onAddSticky={() => {}}
        onHistory={() => {}}
        onZoom={() => {}}
        zoomPercent={100}
        theme={theme}
      />,
    );
  const fills = () =>
    screen
      .getAllByRole('menuitemradio')
      .map((swatch) => swatch.querySelector('svg path')?.getAttribute('fill'));

  it('shows the paper of every color in the light theme', () => {
    renderEditor('light');
    fireEvent.click(screen.getByTestId('elysion-sticky-color'));

    expect(fills()).toEqual(STICKY_COLORS.map((color) => paperColor(color)));
  });

  it('shows them as the dark theme draws them, so the menu and the note on the canvas look the same', () => {
    renderEditor('dark');
    fireEvent.click(screen.getByTestId('elysion-sticky-color'));

    expect(fills()).toEqual(STICKY_COLORS.map((color) => seenColor(paperColor(color), 'dark')));
    expect(fills()[0]).toBe('#503700'); // yellow: dark amber on the dark canvas, not the pale paper
    expect(fills()).not.toEqual(STICKY_COLORS.map((color) => paperColor(color)));
  });

  it('shows the current color on the button in the theme too', () => {
    renderEditor('dark');

    const icon = screen.getByTestId('elysion-tool-sticky').querySelector('svg path');
    expect(icon?.getAttribute('fill')).toBe(seenColor(paperColor(STICKY_COLORS[0]), 'dark'));
  });
});
