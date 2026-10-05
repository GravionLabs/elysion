import { waitFor } from '@testing-library/dom';
import { describe, expect, it, vi } from 'vitest';
import { ELEMENT_TAG_NAME } from './element';

describe('elysion-canvas custom element', () => {
  it('registers itself and renders when attached to the DOM', async () => {
    expect(customElements.get(ELEMENT_TAG_NAME)).toBeDefined();

    const el = document.createElement(ELEMENT_TAG_NAME);
    el.setAttribute('board-id', 'test-board');
    el.setAttribute('yjs-server-url', 'ws://localhost:9999/yjs');

    const readyHandler = vi.fn();
    el.addEventListener('ready', readyHandler);

    document.body.appendChild(el);

    expect(readyHandler).toHaveBeenCalledOnce();
    await waitFor(() => expect(el.querySelector('[data-testid="toolbar-rectangle"]')).toBeTruthy());

    document.body.removeChild(el);
  });

  it('announces the connection status as a status event', async () => {
    const el = document.createElement(ELEMENT_TAG_NAME);
    const statuses: string[] = [];
    el.addEventListener('status', (event) => statuses.push((event as CustomEvent).detail.status));

    document.body.appendChild(el);
    await waitFor(() => expect(statuses).toContain('connecting'));

    document.body.removeChild(el);
  });

  it('exposes toggleLibrary() and announces the sidebar as a librarychange event', async () => {
    const el = document.createElement(ELEMENT_TAG_NAME) as HTMLElement & { toggleLibrary(): void };
    const changes: boolean[] = [];
    el.addEventListener('librarychange', (event) =>
      changes.push((event as CustomEvent).detail.open),
    );

    // Before the canvas is up, the method is there and harmless.
    expect(() => el.toggleLibrary()).not.toThrow();

    document.body.appendChild(el);
    await waitFor(() => expect(el.querySelector('[data-testid="toolbar-rectangle"]')).toBeTruthy());

    el.toggleLibrary();
    await waitFor(() => expect(changes).toEqual([true]));
    el.toggleLibrary();
    await waitFor(() => expect(changes).toEqual([true, false]));

    document.body.removeChild(el);
  });

  it('has export and import methods that are safe before the canvas is up', async () => {
    const el = document.createElement(ELEMENT_TAG_NAME) as HTMLElement & {
      exportBoard(format: string): Promise<Blob | null>;
      importFile(file: Blob): Promise<number>;
    };

    await expect(el.exportBoard('svg')).resolves.toBeNull();
    await expect(el.importFile(new Blob(['{}']))).rejects.toThrow('not ready');
  });

  it('exports through the element once the canvas is up', async () => {
    const el = document.createElement(ELEMENT_TAG_NAME) as HTMLElement & {
      exportBoard(format: string): Promise<Blob | null>;
    };
    document.body.appendChild(el);
    await waitFor(() => expect(el.querySelector('[data-testid="toolbar-rectangle"]')).toBeTruthy());

    await expect(el.exportBoard('excalidraw')).resolves.toBeNull(); // empty board, but it is answered

    document.body.removeChild(el);
  });
});
