import { Writable } from 'node:stream';
import { currentRequestId, isValidRequestId } from '@elysion/node-logging';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryDocumentStore } from '../src/persistence/in-memory-document-store.js';
import type { SaveResult, StoredDocument } from '../src/persistence/document-store.js';
import { SyncClient, startInstance, waitUntil } from './helpers.js';
import { boardUrl, signWsToken } from './ws-token.js';

type Line = Record<string, any>;

/** An in-memory store that remembers which request id each call was made for (what the backend would receive). */
class RecordingStore extends InMemoryDocumentStore {
  readonly calls: Array<{ call: 'load' | 'save'; requestId: string | undefined }> = [];

  override async load(boardId: string): Promise<StoredDocument | null> {
    this.calls.push({ call: 'load', requestId: currentRequestId() });
    return super.load(boardId);
  }

  override async save(
    boardId: string,
    state: Uint8Array,
    baseVersion: string | null,
  ): Promise<SaveResult> {
    this.calls.push({ call: 'save', requestId: currentRequestId() });
    return super.save(boardId, state, baseVersion);
  }
}

describe('Logging (e2e, ADR 0025)', () => {
  let raw: string[];
  let store: RecordingStore;
  let instance: Awaited<ReturnType<typeof startInstance>>;

  const lines = (): Line[] =>
    raw
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Line);
  const lineWith = (message: string): Line | undefined =>
    lines().find((line) => line.message === message);

  beforeEach(async () => {
    raw = [];
    store = new RecordingStore();
    const stream = new Writable({
      write(chunk, _encoding, done) {
        raw.push(String(chunk));
        done();
      },
    });
    instance = await startInstance(store, {}, stream);
  });

  afterEach(async () => {
    await instance.app.close();
  });

  const board = () => `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  it('gives a connection the id of its upgrade request and says who it is', async () => {
    const boardId = board();
    const client = new SyncClient(
      boardUrl(instance.url, boardId, { sub: 'kc-sub-9', role: 'editor' }),
      {
        headers: { 'X-Request-Id': 'conn-1234.abcd_EF' },
      },
    );
    await client.waitForOpen();
    await waitUntil(() => lineWith('WebSocket connection admitted') !== undefined);
    client.close();
    await waitUntil(() => lineWith('WebSocket connection closed') !== undefined);

    for (const message of ['WebSocket connection admitted', 'WebSocket connection closed']) {
      expect(lineWith(message)).toMatchObject({
        level: 'info',
        service: 'elysion-realtime',
        requestId: 'conn-1234.abcd_EF',
        userId: 'kc-sub-9',
        boardId,
      });
    }
    expect(lineWith('WebSocket connection admitted')).toMatchObject({ role: 'editor' });
  });

  it('creates an id for a connection that has none, and replaces one that is not well formed', async () => {
    const without = new SyncClient(boardUrl(instance.url, board()));
    await without.waitForOpen();
    const bad = new SyncClient(boardUrl(instance.url, board()), {
      headers: { 'X-Request-Id': 'bad id with spaces' },
    });
    await bad.waitForOpen();
    await waitUntil(
      () => lines().filter((l) => l.message === 'WebSocket connection admitted').length === 2,
    );

    const ids = lines()
      .filter((l) => l.message === 'WebSocket connection admitted')
      .map((l) => l.requestId);
    expect(ids.every(isValidRequestId)).toBe(true);
    expect(new Set(ids).size).toBe(2);
    expect(raw.join('')).not.toContain('bad id with spaces');
    without.close();
    bad.close();
  });

  it('asks the store for the board, and saves it, as that connection', async () => {
    const boardId = board();
    const client = new SyncClient(boardUrl(instance.url, boardId), {
      headers: { 'X-Request-Id': 'conn-save-0001' },
    });
    await client.waitForOpen();
    client.doc.getMap('elements').set('rect-1', { type: 'rectangle' });
    await new Promise((resolve) => setTimeout(resolve, 150)); // let the update reach the server
    client.close();
    await waitUntil(() => store.documents.has(boardId));

    expect(store.calls.find((c) => c.call === 'load')?.requestId).toBe('conn-save-0001');
    expect(store.calls.find((c) => c.call === 'save')?.requestId).toBe('conn-save-0001');
  });

  it('logs why a connection was refused, and never the token', async () => {
    const boardId = board();
    const expired = boardUrl(instance.url, boardId, { expiresIn: -600 });
    const token = new URL(expired).searchParams.get('token')!;
    const client = new SyncClient(expired);
    expect(await client.closed).toBe(4401);
    const other = new SyncClient(
      `${instance.url}?board=${boardId}&token=${signWsToken('another-board')}`,
    );
    expect(await other.closed).toBe(4403);
    await waitUntil(
      () => lines().filter((l) => l.message === 'WebSocket connection refused').length === 2,
    );

    const refusals = lines().filter((l) => l.message === 'WebSocket connection refused');
    expect(refusals[0]).toMatchObject({
      level: 'warn',
      reason: 'expired',
      closeCode: 4401,
      boardId,
    });
    expect(refusals[1]).toMatchObject({
      level: 'warn',
      reason: 'wrong_board',
      closeCode: 4403,
      boardId,
    });
    expect(raw.join('')).not.toContain(token);
    expect(raw.join('')).not.toContain(signWsToken('another-board'));
  });

  it('never writes the token query parameter or the secrets', async () => {
    const boardId = board();
    const url = boardUrl(instance.url, boardId);
    const token = new URL(url).searchParams.get('token')!;
    const client = new SyncClient(url);
    await client.waitForOpen();
    await request(instance.url.replace('ws://', 'http://').replace('/yjs', ''))
      .get('/health?token=query-marker')
      .set('Cookie', 'session=cookie-marker')
      .set('Authorization', 'Bearer header-marker');
    client.close();
    await waitUntil(() => lineWith('WebSocket connection closed') !== undefined);

    const output = raw.join('');
    for (const secret of [
      token,
      'query-marker',
      'cookie-marker',
      'header-marker',
      process.env.WS_TOKEN_SECRET!,
      process.env.INTERNAL_API_SECRET!,
    ]) {
      expect(output).not.toContain(secret);
    }
  });

  it('gives an HTTP request an id too, echoes it, and keeps health checks at debug', async () => {
    const http = instance.url.replace('ws://', 'http://').replace('/yjs', '');

    const response = await request(http)
      .get('/health')
      .set('X-Request-Id', 'health-req-0001')
      .expect(200);

    expect(response.headers['x-request-id']).toBe('health-req-0001');
    expect(lines().filter((l) => l.http?.route === '/health')).toEqual([]);
  });
});
