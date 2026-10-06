import { waitFor } from '@testing-library/dom';
import { describe, expect, it, vi } from 'vitest';
import { ELEMENT_TAG_NAME } from './element';

const ELEMENT_OBSERVES = (
  customElements.get(ELEMENT_TAG_NAME) as unknown as { observedAttributes: string[] }
).observedAttributes;

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

  it('announces a failed connection as an error event with a message', async () => {
    const el = document.createElement(ELEMENT_TAG_NAME);
    el.setAttribute('yjs-server-url', 'ws://127.0.0.1:1/yjs'); // nothing listens on port 1
    const messages: string[] = [];
    el.addEventListener('error', (event) =>
      messages.push((event as unknown as CustomEvent).detail?.message),
    );

    document.body.appendChild(el);
    await waitFor(() => expect(messages.length).toBeGreaterThan(0), { timeout: 3000 });

    expect(messages[0]).toMatch(/connection/i);
    document.body.removeChild(el);
  });

  it('takes the user name and color as attributes without restarting the canvas', async () => {
    const el = document.createElement(ELEMENT_TAG_NAME);
    const statuses: string[] = [];
    el.addEventListener('status', (event) => statuses.push((event as CustomEvent).detail.status));
    document.body.appendChild(el);
    await waitFor(() => expect(statuses).toContain('connecting'));
    const connectsBefore = statuses.filter((status) => status === 'connecting').length;

    el.setAttribute('user-name', 'Ada');
    el.setAttribute('user-color', '#14b8a6');
    await waitFor(() => expect(el.querySelector('[data-testid="toolbar-rectangle"]')).toBeTruthy());

    expect(ELEMENT_OBSERVES).toEqual(expect.arrayContaining(['user-name', 'user-color']));
    expect(statuses.filter((status) => status === 'connecting')).toHaveLength(connectsBefore);
    document.body.removeChild(el);
  });

  it('has a tokenProvider property that is used for the connection and can be set later', async () => {
    const el = document.createElement(ELEMENT_TAG_NAME) as HTMLElement & {
      tokenProvider?: () => Promise<string | null>;
    };
    el.setAttribute('yjs-server-url', 'ws://127.0.0.1:1/yjs'); // nothing listens: the point is that the provider is asked
    const asked = vi.fn(async () => null); // null: the host does not want a connection
    expect(el.tokenProvider).toBeUndefined();

    el.tokenProvider = asked;
    document.body.appendChild(el);

    await waitFor(() => expect(asked).toHaveBeenCalled());
    expect(el.tokenProvider).toBe(asked);
    document.body.removeChild(el);
  });

  it('takes a tokenProvider that was set before the element was upgraded (the script loads lazily)', async () => {
    const el = document.createElement(ELEMENT_TAG_NAME) as HTMLElement & {
      tokenProvider?: () => Promise<string | null>;
    };
    el.setAttribute('yjs-server-url', 'ws://127.0.0.1:1/yjs');
    const asked = vi.fn(async () => null);
    // What a host's property binding leaves on an element that is not upgraded yet: an own data property.
    Object.defineProperty(el, 'tokenProvider', {
      value: asked,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    expect(Object.getOwnPropertyDescriptor(el, 'tokenProvider')?.value).toBe(asked);

    document.body.appendChild(el);

    await waitFor(() => expect(asked).toHaveBeenCalled());
    expect(Object.getOwnPropertyDescriptor(el, 'tokenProvider')).toBeUndefined(); // the accessor is in charge again
    expect(el.tokenProvider).toBe(asked);
    document.body.removeChild(el);
  });

  it('shows a viewer the board in view mode: no drawing tools, no import, only the zoom', async () => {
    const el = document.createElement(ELEMENT_TAG_NAME) as HTMLElement & {
      importFile(file: Blob): Promise<number>;
    };
    el.setAttribute('readonly', '');
    document.body.appendChild(el);

    await waitFor(() => expect(el.querySelector('.excalidraw--view-mode')).toBeTruthy());
    expect(el.querySelector('[data-testid="elysion-tool-rectangle"]')).toBeNull();
    expect(el.querySelector('[data-testid="elysion-tool-sticky"]')).toBeNull();
    expect(el.querySelector('[data-testid="elysion-undo"]')).toBeNull();
    expect(el.querySelector('[data-testid="elysion-zoom-in"]')).toBeTruthy();
    await expect(el.importFile(new Blob(['{}']))).rejects.toThrow('read-only');
    document.body.removeChild(el);
  });

  it('gives an editor the tools, and follows the readonly attribute when it changes', async () => {
    const el = document.createElement(ELEMENT_TAG_NAME);
    document.body.appendChild(el);
    await waitFor(() =>
      expect(el.querySelector('[data-testid="elysion-tool-rectangle"]')).toBeTruthy(),
    );
    expect(el.querySelector('.excalidraw--view-mode')).toBeNull();

    el.setAttribute('readonly', '');
    await waitFor(() => expect(el.querySelector('.excalidraw--view-mode')).toBeTruthy());
    expect(el.querySelector('[data-testid="elysion-tool-rectangle"]')).toBeNull();

    el.removeAttribute('readonly');
    await waitFor(() =>
      expect(el.querySelector('[data-testid="elysion-tool-rectangle"]')).toBeTruthy(),
    );
    expect(el.querySelector('.excalidraw--view-mode')).toBeNull();
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
