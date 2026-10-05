import type { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test, TestingModule } from '@nestjs/testing';
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

function toUint8Array(data: RawData): Uint8Array {
  if (Array.isArray(data)) {
    return new Uint8Array(Buffer.concat(data));
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/**
 * A minimal stand-in for a real Yjs client, speaking the same sync
 * sub-protocol as YjsGateway (see src/yjs/yjs.gateway.ts) directly over a
 * raw `ws` connection — exercising the actual wire format end to end
 * rather than mocking anything.
 */
class TestYjsClient {
  readonly doc = new Y.Doc();
  private readonly socket: WebSocket;

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.on('message', (data) => this.handleMessage(data));
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this) {
        return; // an update we just applied FROM the server — don't echo it back
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.socket.send(encoding.toUint8Array(encoder));
    });
  }

  private handleMessage(data: RawData): void {
    const decoder = decoding.createDecoder(toUint8Array(data));
    const messageType = decoding.readVarUint(decoder);
    if (messageType !== MESSAGE_SYNC) {
      return;
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
    if (encoding.length(encoder) > 1) {
      this.socket.send(encoding.toUint8Array(encoder));
    }
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

function waitUntil(check: () => boolean, timeoutMs = 2000): Promise<void> {
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

describe('Yjs sync gateway (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DocumentStore)
      .useValue(new InMemoryDocumentStore())
      .compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.listen(0);

    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `ws://127.0.0.1:${address.port}/yjs`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('converges two clients on the same board after either applies an update', async () => {
    const boardId = `board-${Date.now()}`;
    const clientA = new TestYjsClient(`${baseUrl}?board=${boardId}`);
    const clientB = new TestYjsClient(`${baseUrl}?board=${boardId}`);
    await Promise.all([clientA.waitForOpen(), clientB.waitForOpen()]);

    clientA.doc.getMap('board').set('hello', 'world');
    await waitUntil(() => clientB.doc.getMap('board').get('hello') === 'world');
    expect(clientB.doc.getMap('board').get('hello')).toBe('world');

    clientB.doc.getMap('board').set('from', 'b');
    await waitUntil(() => clientA.doc.getMap('board').get('from') === 'b');
    expect(clientA.doc.getMap('board').get('from')).toBe('b');

    clientA.close();
    clientB.close();
  });

  it('keeps different boards independent', async () => {
    const clientA = new TestYjsClient(`${baseUrl}?board=board-a-${Date.now()}`);
    const clientB = new TestYjsClient(`${baseUrl}?board=board-b-${Date.now()}`);
    await Promise.all([clientA.waitForOpen(), clientB.waitForOpen()]);

    clientA.doc.getMap('board').set('only', 'a');
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(clientB.doc.getMap('board').get('only')).toBeUndefined();

    clientA.close();
    clientB.close();
  });
});
