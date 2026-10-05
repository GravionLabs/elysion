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
import { MESSAGE_SYNC } from '../src/yjs/protocol.js';
import { PERSISTENCE_OPTIONS } from '../src/yjs/yjs-room-registry.js';

/** Helpers shared by the e2e suites that drive the real app with real WebSocket clients. */

function toUint8Array(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/** Speaks the sync protocol both ways: asks for the server's state on open and sends its own updates. */
export class SyncClient {
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

export function waitUntil(check: () => boolean, timeoutMs = 3000): Promise<void> {
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

export async function startInstance(
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
