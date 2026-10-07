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
      insertFile(file: Blob): Promise<number>;
    };
    el.setAttribute('readonly', '');
    document.body.appendChild(el);

    await waitFor(() => expect(el.querySelector('.excalidraw--view-mode')).toBeTruthy());
    expect(el.querySelector('[data-testid="elysion-tool-rectangle"]')).toBeNull();
    expect(el.querySelector('[data-testid="elysion-tool-sticky"]')).toBeNull();
    expect(el.querySelector('[data-testid="elysion-undo"]')).toBeNull();
    expect(el.querySelector('[data-testid="elysion-zoom-in"]')).toBeTruthy();
    await expect(el.importFile(new Blob(['{}']))).rejects.toThrow('read-only');
    await expect(el.insertFile(new Blob(['{}']))).rejects.toThrow('read-only');
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
      insertFile(file: Blob): Promise<number>;
    };

    await expect(el.exportBoard('svg')).resolves.toBeNull();
    await expect(el.importFile(new Blob(['{}']))).rejects.toThrow('not ready');
    await expect(el.insertFile(new Blob(['{}']))).rejects.toThrow('not ready');
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

  describe('the shared timer', () => {
    type TimerElement = HTMLElement & {
      startTimer(durationMs: number): Promise<void>;
      pauseTimer(): Promise<void>;
      resumeTimer(): Promise<void>;
      extendTimer(ms: number): Promise<void>;
      stopTimer(): Promise<void>;
    };
    const mount = async (attributes: Record<string, string> = {}) => {
      const el = document.createElement(ELEMENT_TAG_NAME) as TimerElement;
      el.setAttribute('yjs-server-url', 'ws://localhost:9999/yjs');
      el.setAttribute('board-id', `timer-${crypto.randomUUID()}`);
      for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
      const states: Array<{ state: unknown }> = [];
      el.addEventListener('timer', (event) => states.push((event as CustomEvent).detail));
      document.body.appendChild(el);
      await waitFor(() => expect(el.querySelector('.excalidraw')).toBeTruthy());
      return { el, states };
    };

    it('has methods that reject before the canvas is up', async () => {
      const el = document.createElement(ELEMENT_TAG_NAME) as TimerElement;

      await expect(el.startTimer(60_000)).rejects.toThrow('not ready');
      await expect(el.pauseTimer()).rejects.toThrow('not ready');
      await expect(el.resumeTimer()).rejects.toThrow('not ready');
      await expect(el.extendTimer(60_000)).rejects.toThrow('not ready');
      await expect(el.stopTimer()).rejects.toThrow('not ready');
    });

    it('starts a timer and announces the state as a timer event, then every change after it', async () => {
      const { el, states } = await mount({ 'user-id': 'kc-1', 'user-name': 'Ada' });

      // The controls arrive when Excalidraw is up: ask until the element answers.
      await waitFor(async () => {
        await el.startTimer(5 * 60_000);
        expect(states.length).toBeGreaterThan(0);
      });
      expect(states.at(-1)?.state).toMatchObject({
        durationMs: 5 * 60_000,
        pausedAt: null,
        startedBy: { id: 'kc-1', name: 'Ada' },
      });

      await el.pauseTimer();
      expect(states.at(-1)?.state).toMatchObject({ pausedAt: expect.any(Number) });
      await el.resumeTimer();
      expect(states.at(-1)?.state).toMatchObject({ pausedAt: null });
      await el.extendTimer(60_000);
      expect((states.at(-1)!.state as { durationMs: number }).durationMs).toBeGreaterThan(
        5 * 60_000,
      );
      await el.stopTimer();
      expect(states.at(-1)).toEqual({ state: null });

      document.body.removeChild(el);
    });

    it('uses a per-tab id when the host gives none', async () => {
      const { el, states } = await mount();
      await waitFor(async () => {
        await el.startTimer(60_000);
        expect(states.length).toBeGreaterThan(0);
      });

      expect((states.at(-1)!.state as { startedBy: { id: string } }).startedBy.id).toMatch(/\S+/);
      document.body.removeChild(el);
    });

    it('rejects every method on a read-only canvas and announces nothing', async () => {
      const { el, states } = await mount({ readonly: '' });
      await waitFor(async () => {
        await expect(el.startTimer(60_000)).rejects.toThrow('read-only');
      });
      await expect(el.pauseTimer()).rejects.toThrow('read-only');
      await expect(el.resumeTimer()).rejects.toThrow('read-only');
      await expect(el.extendTimer(60_000)).rejects.toThrow('read-only');
      await expect(el.stopTimer()).rejects.toThrow('read-only');

      expect(states).toEqual([]);
      document.body.removeChild(el);
    });

    it('rejects a duration that makes no sense', async () => {
      const { el } = await mount();
      await waitFor(async () => {
        await expect(el.startTimer(-1)).rejects.toThrow('milliseconds');
      });
      document.body.removeChild(el);
    });

    it('observes user-id', () => {
      expect(ELEMENT_OBSERVES).toContain('user-id');
    });
  });

  describe('dot voting', () => {
    type VotingElement = HTMLElement & {
      startVoting(options: { name?: string; votesPerPerson: number }): Promise<void>;
      endVoting(): Promise<void>;
      clearVotingResults(): Promise<void>;
      scrollToElement(id: string): Promise<void>;
    };
    const mount = async (attributes: Record<string, string> = {}) => {
      const el = document.createElement(ELEMENT_TAG_NAME) as VotingElement;
      el.setAttribute('yjs-server-url', 'ws://localhost:9999/yjs');
      el.setAttribute('board-id', `voting-${crypto.randomUUID()}`);
      for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
      const sessions: Array<{ session: Record<string, unknown> | null }> = [];
      el.addEventListener('voting', (event) => sessions.push((event as CustomEvent).detail));
      document.body.appendChild(el);
      await waitFor(() => expect(el.querySelector('.excalidraw')).toBeTruthy());
      return { el, sessions };
    };

    it('has methods that reject before the canvas is up', async () => {
      const el = document.createElement(ELEMENT_TAG_NAME) as VotingElement;

      await expect(el.startVoting({ votesPerPerson: 3 })).rejects.toThrow('not ready');
      await expect(el.endVoting()).rejects.toThrow('not ready');
      await expect(el.clearVotingResults()).rejects.toThrow('not ready');
      await expect(el.scrollToElement('x')).rejects.toThrow('not ready');
    });

    it('starts a voting, announces it as a voting event, ends it and clears it', async () => {
      const { el, sessions } = await mount({ 'user-id': 'kc-1', 'user-name': 'Ada' });

      await waitFor(async () => {
        await el.startVoting({ name: 'Pick one', votesPerPerson: 5 });
        expect(sessions.length).toBeGreaterThan(0);
      });
      expect(sessions.at(-1)!.session).toMatchObject({
        name: 'Pick one',
        votesPerPerson: 5,
        status: 'open',
        myVotes: 0,
        startedBy: { id: 'kc-1', name: 'Ada' },
      });
      expect(sessions.at(-1)!.session).not.toHaveProperty('tally');

      await expect(el.startVoting({ votesPerPerson: 3 })).rejects.toThrow('already open');

      await el.endVoting();
      expect(sessions.at(-1)!.session).toMatchObject({ status: 'closed', tally: [] });
      await el.endVoting(); // twice is the same as once

      await el.clearVotingResults();
      expect(sessions.at(-1)).toEqual({ session: null });
      await el.clearVotingResults();

      // An older closed voting does not come back after the last one was cleared: clearing removes them all.
      await el.startVoting({ name: 'First', votesPerPerson: 1 });
      await el.endVoting();
      await el.startVoting({ name: 'Second', votesPerPerson: 1 });
      await el.endVoting();
      expect(sessions.at(-1)!.session).toMatchObject({ name: 'Second', status: 'closed' });
      await el.clearVotingResults();
      expect(sessions.at(-1)).toEqual({ session: null });
      await el.startVoting({ name: 'Third', votesPerPerson: 1 });
      await el.clearVotingResults();
      expect(sessions.at(-1)!.session).toMatchObject({ name: 'Third', status: 'open' }); // an open one stays
      document.body.removeChild(el);
    });

    it('rejects a number of votes that makes no sense', async () => {
      const { el } = await mount();
      await waitFor(async () => {
        await expect(el.startVoting({ votesPerPerson: 0 })).rejects.toThrow('between 1 and');
      });
      document.body.removeChild(el);
    });

    it('rejects starting, ending and clearing on a read-only canvas, and announces nothing', async () => {
      const { el, sessions } = await mount({ readonly: '' });
      await waitFor(async () => {
        await expect(el.startVoting({ votesPerPerson: 3 })).rejects.toThrow('read-only');
      });
      await expect(el.endVoting()).rejects.toThrow('read-only');
      await expect(el.clearVotingResults()).rejects.toThrow('read-only');

      expect(sessions).toEqual([]);
      document.body.removeChild(el);
    });

    it('lets a viewer scroll to an element, and says when it is not there', async () => {
      const { el } = await mount({ readonly: '' });
      await waitFor(async () => {
        await expect(el.scrollToElement('missing')).rejects.toThrow('not on the board');
      });
      document.body.removeChild(el);
    });
  });
});
