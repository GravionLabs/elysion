import { waitFor } from '@testing-library/dom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ELEMENT_TAG_NAME } from './element';
import type { FollowState } from './presence/follow';
import { startTestYjsServer, type TestYjsServer } from './yjs/test-yjs-server';

type FollowElement = HTMLElement & {
  follow(userId: string): Promise<void>;
  stopFollowing(): Promise<void>;
  followPresenter(): Promise<void>;
  startPresenting(): Promise<void>;
  stopPresenting(): Promise<void>;
  summonEveryone(): Promise<void>;
};

describe('following and presenting through the element (#848)', () => {
  let server: TestYjsServer;
  beforeAll(async () => {
    server = await startTestYjsServer();
  });
  afterAll(async () => {
    await server.close();
  });

  const mounted: HTMLElement[] = [];
  const mount = async (board: string, attributes: Record<string, string>) => {
    const el = document.createElement(ELEMENT_TAG_NAME) as FollowElement;
    el.setAttribute('yjs-server-url', server.url);
    el.setAttribute('board-id', board);
    for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
    const states: FollowState[] = [];
    el.addEventListener('follow', (event) => states.push((event as CustomEvent).detail));
    document.body.appendChild(el);
    mounted.push(el);
    await waitFor(() => expect(el.querySelector('.excalidraw')).toBeTruthy());
    return { el, states, last: () => states.at(-1) };
  };
  const cleanup = () => {
    for (const el of mounted.splice(0)) el.remove();
  };

  it('rejects every method before the canvas is up', async () => {
    const el = document.createElement(ELEMENT_TAG_NAME) as FollowElement;

    await expect(el.follow('ada')).rejects.toThrow('not ready');
    await expect(el.stopFollowing()).rejects.toThrow('not ready');
    await expect(el.followPresenter()).rejects.toThrow('not ready');
    await expect(el.startPresenting()).rejects.toThrow('not ready');
    await expect(el.stopPresenting()).rejects.toThrow('not ready');
    await expect(el.summonEveryone()).rejects.toThrow('not ready');
  });

  it('lets a viewer follow but not present, end or summon', async () => {
    const { el } = await mount(`viewer-${crypto.randomUUID()}`, {
      readonly: '',
      'user-id': 'v',
    });

    await waitFor(async () => {
      await expect(el.startPresenting()).rejects.toThrow('read-only');
    });
    await expect(el.stopPresenting()).rejects.toThrow('read-only');
    await expect(el.summonEveryone()).rejects.toThrow('read-only');
    await expect(el.follow('nobody')).rejects.toThrow('not on the board');
    cleanup();
  });

  it('makes everybody follow the presenter, and ends for everybody when the presenter ends it', async () => {
    const board = `present-${crypto.randomUUID()}`;
    const ada = await mount(board, { 'user-id': 'ada', 'user-name': 'Ada' });
    const bea = await mount(board, { 'user-id': 'bea', 'user-name': 'Bea', readonly: '' });
    await waitFor(() => expect(ada.el.querySelector('.excalidraw')).toBeTruthy());

    await waitFor(async () => {
      await ada.el.startPresenting();
      expect(ada.last()?.presenter).toMatchObject({ id: 'ada', me: true });
    });
    await waitFor(() =>
      expect(bea.last()).toMatchObject({
        following: { id: 'ada', name: 'Ada', reason: 'presenter' },
        presenter: { id: 'ada', me: false },
        steppedOut: false,
      }),
    );
    // The viewer can step out and back in.
    await bea.el.stopFollowing();
    await waitFor(() => expect(bea.last()).toMatchObject({ following: null, steppedOut: true }));
    await bea.el.followPresenter();
    await waitFor(() => expect(bea.last()?.following?.reason).toBe('presenter'));
    // A viewer cannot end it.
    await expect(bea.el.stopPresenting()).rejects.toThrow('read-only');

    await ada.el.stopPresenting();
    await waitFor(() => expect(bea.last()).toMatchObject({ following: null, presenter: null }));
    cleanup();
  });

  it('lets only the presenter or an owner end a presentation, and only an owner replace it', async () => {
    const board = `owner-${crypto.randomUUID()}`;
    const ada = await mount(board, { 'user-id': 'ada' });
    const ed = await mount(board, { 'user-id': 'ed' });
    const owner = await mount(board, { 'user-id': 'olga', 'can-moderate': '' });
    await waitFor(async () => {
      await ada.el.startPresenting();
      expect(ed.last()?.presenter).toMatchObject({ id: 'ada' });
      expect(owner.last()?.presenter).toMatchObject({ id: 'ada' });
    });

    await expect(ed.el.stopPresenting()).rejects.toThrow('presenter or an owner');
    await expect(ed.el.startPresenting()).rejects.toThrow('Somebody else is presenting');
    await owner.el.stopPresenting();
    await waitFor(() => expect(ed.last()?.presenter).toBeNull());
    await ed.el.startPresenting(); // nobody presents any more
    await waitFor(() => expect(ada.last()?.presenter).toMatchObject({ id: 'ed' }));
    cleanup();
  });

  it('shows the same person once for several tabs, under the id the host gave', async () => {
    const board = `tabs-${crypto.randomUUID()}`;
    const users: Array<Array<{ id: string }>> = [];
    const viewer = await mount(board, { 'user-id': 'me' });
    viewer.el.addEventListener('presence', (event) =>
      users.push((event as CustomEvent).detail.users),
    );
    await mount(board, { 'user-id': 'ada', 'user-name': 'Ada' });
    await mount(board, { 'user-id': 'ada', 'user-name': 'Ada' });

    await waitFor(() => expect(users.at(-1)).toEqual([expect.objectContaining({ id: 'ada' })]));
    cleanup();
  });
});
