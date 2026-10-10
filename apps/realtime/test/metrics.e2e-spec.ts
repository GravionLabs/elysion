import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryDocumentStore } from '../src/persistence/in-memory-document-store.js';
import { SyncClient, startInstance } from './helpers.js';
import { boardUrl } from './ws-token.js';

/** Retries an assertion until it holds: admissions and disconnects finish a moment after the sockets do. */
async function eventually(check: () => Promise<void>, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

describe('Metrics (e2e)', () => {
  let app: INestApplication;
  let url: string;

  beforeEach(async () => {
    ({ app, url } = await startInstance(new InMemoryDocumentStore()));
  });

  afterEach(async () => {
    await app.close();
  });

  const scrape = async () => (await request(app.getHttpServer()).get('/metrics').expect(200)).text;
  const gauge = (text: string, name: string) =>
    Number(new RegExp(`^${name} (\\d+)$`, 'm').exec(text)?.[1] ?? NaN);

  it('serves the Prometheus text format with the process metrics', async () => {
    const response = await request(app.getHttpServer()).get('/metrics').expect(200);

    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toContain('# TYPE process_cpu_user_seconds_total counter');
  });

  it('counts the open connections and the rooms, and goes down again when they leave', async () => {
    expect(gauge(await scrape(), 'elysion_realtime_websocket_connections')).toBe(0);
    expect(gauge(await scrape(), 'elysion_realtime_rooms')).toBe(0);

    const a = new SyncClient(boardUrl(url, 'board-a'));
    const b = new SyncClient(boardUrl(url, 'board-a'));
    const c = new SyncClient(boardUrl(url, 'board-b'));
    await Promise.all([a.waitForOpen(), b.waitForOpen(), c.waitForOpen()]);

    await eventually(async () =>
      expect(gauge(await scrape(), 'elysion_realtime_websocket_connections')).toBe(3),
    );
    expect(gauge(await scrape(), 'elysion_realtime_rooms')).toBe(2);

    a.close();
    b.close();
    c.close();
    await Promise.all([a.closed, b.closed, c.closed]);

    await eventually(async () =>
      expect(gauge(await scrape(), 'elysion_realtime_websocket_connections')).toBe(0),
    );
  });

  it('counts a saved document and observes its size', async () => {
    const a = new SyncClient(boardUrl(url, 'board-a'));
    await a.waitForOpen();
    a.doc.getMap('elements').set('rect-1', { type: 'rectangle', x: 1, y: 2 });

    await eventually(async () => {
      const text = await scrape(); // saved a debounce after the change
      expect(gauge(text, 'elysion_realtime_document_saves_total')).toBe(1);
      expect(gauge(text, 'elysion_realtime_document_size_bytes_count')).toBe(1);
    });
    a.close();
    expect(gauge(await scrape(), 'elysion_realtime_document_save_failures_total')).toBe(0);
  });
});
