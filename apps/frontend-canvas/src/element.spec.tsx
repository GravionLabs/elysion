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
});
