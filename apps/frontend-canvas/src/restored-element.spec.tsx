import { waitFor } from '@testing-library/dom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ELEMENT_TAG_NAME } from './element';
import { startTestYjsServer, type TestYjsServer } from './yjs/test-yjs-server';

describe('a restore of the board through the element (#847)', () => {
  let server: TestYjsServer;
  beforeAll(async () => {
    server = await startTestYjsServer();
  });
  afterAll(async () => {
    await server.close();
  });

  const mount = async (attributes: Record<string, string> = {}) => {
    const el = document.createElement(ELEMENT_TAG_NAME);
    el.setAttribute('yjs-server-url', server.url);
    el.setAttribute('board-id', `restore-${crypto.randomUUID()}`);
    for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
    const notices: string[] = [];
    el.addEventListener('notice', (event) =>
      notices.push((event as CustomEvent<{ message: string }>).detail.message),
    );
    document.body.appendChild(el);
    await waitFor(() => expect(el.querySelector('.excalidraw')).toBeTruthy());
    // The connection is up when the server has accepted it.
    await waitFor(() => expect(server.connectionUrls().length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { el, notices };
  };

  it('tells the person who restored which version, with the time of the version', async () => {
    const { el, notices } = await mount();

    server.sendRestored({ by: 'Ada', at: '2026-10-31T10:00:00Z', snapshotId: 's1' });

    await waitFor(() => expect(notices).toHaveLength(1));
    expect(notices[0]).toMatch(/^Ada restored the version of /);
    expect(notices[0]).toContain('2026');
    el.remove();
  });

  it('says it in German on a German board', async () => {
    const { el, notices } = await mount({ locale: 'de' });

    server.sendRestored({ by: 'Ada', at: '2026-10-31T10:00:00Z', snapshotId: 's1' });

    await waitFor(() => expect(notices).toHaveLength(1));
    expect(notices[0]).toMatch(/^Ada hat die Version vom .* wiederhergestellt$/);
    el.remove();
  });

  it('ignores an announcement that is not what the service sends', async () => {
    const { el, notices } = await mount();

    server.sendRestored({ by: 5, at: 'yesterday' });
    server.sendRestored('nonsense');
    server.sendRestored({ by: 'Ada', at: '2026-10-31T10:00:00Z' });

    await waitFor(() => expect(notices).toHaveLength(1));
    expect(notices[0]).toMatch(/^Ada restored/);
    el.remove();
  });
});
