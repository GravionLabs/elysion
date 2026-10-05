import type { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import type { RawData } from 'ws';
import { WebSocket } from 'ws';
import { AppModule } from '../src/app.module.js';
import { DocumentStore } from '../src/persistence/document-store.js';
import { InMemoryDocumentStore } from '../src/persistence/in-memory-document-store.js';
import { MESSAGE_SYNC } from '../src/yjs/protocol.js';
import { PERSISTENCE_OPTIONS } from '../src/yjs/yjs-room-registry.js';

/**
 * A board survives a restart of the realtime service (ADR 0011): content drawn in one process is there
 * when a second process, started afterwards against the same store, serves the board. The business
 * backend is replaced by an in-memory store; its HTTP protocol is covered by http-document-store.spec.ts
 * and by the backend's own tests.
 */

function toUint8Array(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/** Speaks the sync protocol both ways: asks for the server's state on open and sends its own updates. */
class SyncClient {
  readonly doc = new Y.Doc();
  readonly closed: Promise<number>;
  private readonly socket: WebSocket;

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.closed = new Promise((resolve) => this.socket.once('close', (code) => resolve(code)));
    this.socket.on('open', () => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, this.doc);
      this.socket.send(encoding.toUint8Array(encoder));
    });
    this.socket.on('message', (data: RawData) => {
      const decoder = decoding.createDecoder(toUint8Array(data));
      if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
      if (encoding.length(encoder) > 1) this.socket.send(encoding.toUint8Array(encoder));
    });
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this || this.socket.readyState !== WebSocket.OPEN) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.socket.send(encoding.toUint8Array(encoder));
    });
  }

  waitForOpen(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.once('open', () => resolve());
      this.socket.once('error', reject);
    });
  }

  close(): void {
    this.socket.close();
  }
}

function waitUntil(check: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error('Timed out waiting for condition'));
      }
    }, 20);
  });
}

async function startInstance(
  store: DocumentStore,
  options: Record<string, number> = {},
): Promise<{ app: INestApplication; url: string }> {
  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DocumentStore)
    .useValue(store)
    .overrideProvider(PERSISTENCE_OPTIONS)
    .useValue({
      saveDebounceMs: 50,
      saveMaxWaitMs: 500,
      retryBaseMs: 50,
      retryMaxMs: 200,
      evictAfterMs: 300,
      ...options,
    })
    .compile();
  const app = moduleFixture.createNestApplication();
  app.useWebSocketAdapter(new WsAdapter(app));
  await app.listen(0);
  const address = app.getHttpServer().address() as AddressInfo;
  return { app, url: `ws://127.0.0.1:${address.port}/yjs` };
}

describe('Board persistence (e2e)', () => {
  it('serves the content of a board after the service was restarted', async () => {
    const store = new InMemoryDocumentStore();
    const boardId = `persist-${Date.now()}`;

    const first = await startInstance(store);
    const drawing = new SyncClient(`${first.url}?board=${boardId}`);
    await drawing.waitForOpen();
    drawing.doc.getMap('elements').set('rect-1', { type: 'rectangle', x: 10, y: 20 });
    await new Promise((resolve) => setTimeout(resolve, 150)); // let the update reach the server
    drawing.close(); // the last client leaving saves the board
    await waitUntil(() => store.documents.has(boardId));
    await first.app.close(); // the process goes away; its memory with it

    const second = await startInstance(store);
    const reopening = new SyncClient(`${second.url}?board=${boardId}`);
    await reopening.waitForOpen();
    await waitUntil(() => reopening.doc.getMap('elements').has('rect-1'));

    expect(reopening.doc.getMap('elements').get('rect-1')).toEqual({
      type: 'rectangle',
      x: 10,
      y: 20,
    });
    reopening.close();
    await second.app.close();
  });

  it('does not save a board nobody changed', async () => {
    const store = new InMemoryDocumentStore();
    const { app, url } = await startInstance(store);
    const viewer = new SyncClient(`${url}?board=untouched-${Date.now()}`);
    await viewer.waitForOpen();
    await new Promise((resolve) => setTimeout(resolve, 100));
    viewer.close();
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(store.documents.size).toBe(0);
    await app.close();
  });

  it('closes the connection instead of serving an empty board when the stored board cannot be loaded', async () => {
    const store = new InMemoryDocumentStore();
    store.load = async () => {
      throw new Error('backend down');
    };
    const { app, url } = await startInstance(store);

    const client = new SyncClient(`${url}?board=unloadable-${Date.now()}`);
    await client.waitForOpen();

    expect(await client.closed).toBe(1011);
    await app.close();
  });

  it('unloads an idle board and serves the stored state again when someone returns', async () => {
    const store = new InMemoryDocumentStore();
    const boardId = `evict-${Date.now()}`;
    const { app, url } = await startInstance(store);

    const drawing = new SyncClient(`${url}?board=${boardId}`);
    await drawing.waitForOpen();
    drawing.doc.getMap('elements').set('rect-1', 'from the first visit');
    await new Promise((resolve) => setTimeout(resolve, 150));
    drawing.close();
    await waitUntil(() => store.documents.has(boardId));
    await new Promise((resolve) => setTimeout(resolve, 600)); // longer than the grace period: the room is unloaded

    // Another instance changes the stored document meanwhile. A room still held in memory would not show it.
    const stored = await store.load(boardId);
    const elsewhere = new Y.Doc();
    Y.applyUpdate(elsewhere, stored!.state);
    elsewhere.getMap('elements').set('rect-2', 'saved by another instance');
    await store.save(boardId, Y.encodeStateAsUpdate(elsewhere), stored!.version);

    const returning = new SyncClient(`${url}?board=${boardId}`);
    await returning.waitForOpen();
    await waitUntil(() => returning.doc.getMap('elements').has('rect-2'));

    expect(returning.doc.getMap('elements').toJSON()).toEqual({
      'rect-1': 'from the first visit',
      'rect-2': 'saved by another instance',
    });
    returning.close();
    await app.close();
  });

  it('keeps an idle board in memory when someone comes back within the grace period', async () => {
    const store = new InMemoryDocumentStore();
    const boardId = `keep-${Date.now()}`;
    const { app, url } = await startInstance(store, { evictAfterMs: 2_000 });

    const first = new SyncClient(`${url}?board=${boardId}`);
    await first.waitForOpen();
    first.doc.getMap('elements').set('a', 1);
    await new Promise((resolve) => setTimeout(resolve, 150));
    first.close();
    await waitUntil(() => store.documents.has(boardId));

    // The stored copy changes behind the room's back; an unchanged room stays as it was in memory.
    const stored = await store.load(boardId);
    const elsewhere = new Y.Doc();
    Y.applyUpdate(elsewhere, stored!.state);
    elsewhere.getMap('elements').set('b', 2);
    await store.save(boardId, Y.encodeStateAsUpdate(elsewhere), stored!.version);

    const second = new SyncClient(`${url}?board=${boardId}`);
    await second.waitForOpen();
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(second.doc.getMap('elements').toJSON()).toEqual({ a: 1 });
    second.close();
    await app.close();
  });
});
