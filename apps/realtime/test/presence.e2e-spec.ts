import type { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test, TestingModule } from '@nestjs/testing';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';
import type { RawData } from 'ws';
import { WebSocket } from 'ws';
import { AppModule } from '../src/app.module.js';
import { DocumentStore } from '../src/persistence/document-store.js';
import { InMemoryDocumentStore } from '../src/persistence/in-memory-document-store.js';
import { MESSAGE_AWARENESS } from '../src/yjs/protocol.js';
import { boardUrl } from './ws-token.js';

/**
 * Requires a real Redis reachable at REDIS_URL (defaults to
 * redis://localhost:6379, the shared Valkey from local-infra) — this
 * suite verifies presence actually crosses process boundaries via Redis
 * pub/sub, which an in-process fake can't exercise.
 */

function toUint8Array(data: RawData): Uint8Array {
  if (Array.isArray(data)) {
    return new Uint8Array(Buffer.concat(data));
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/** A minimal stand-in for a real Yjs awareness client, speaking the same wire format as YjsGateway. */
class TestPresenceClient {
  readonly doc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  private readonly socket: WebSocket;

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.on('message', (data: RawData) => this.handleMessage(data));
  }

  setState(state: Record<string, unknown>): void {
    this.awareness.setLocalState(state);
    this.send(awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.awareness.clientID]));
  }

  private send(update: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, update);
    this.socket.send(encoding.toUint8Array(encoder));
  }

  private handleMessage(data: RawData): void {
    const decoder = decoding.createDecoder(toUint8Array(data));
    const messageType = decoding.readVarUint(decoder);
    if (messageType !== MESSAGE_AWARENESS) {
      return;
    }
    const update = decoding.readVarUint8Array(decoder);
    awarenessProtocol.applyAwarenessUpdate(this.awareness, update, 'remote');
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

  /** Drops the connection without a WebSocket close frame, like a killed browser or a lost network. */
  terminate(): void {
    this.socket.terminate();
  }

  /** The awareness client ids this client currently knows about, besides its own. */
  remoteClientIds(): number[] {
    return [...this.awareness.getStates().keys()].filter((id) => id !== this.awareness.clientID);
  }
}

function waitUntil(check: () => boolean, timeoutMs = 4000): Promise<void> {
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

async function startInstance(): Promise<{ app: INestApplication; baseUrl: string }> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(DocumentStore)
    .useValue(new InMemoryDocumentStore())
    .compile();

  const app = moduleFixture.createNestApplication();
  app.useWebSocketAdapter(new WsAdapter(app));
  await app.listen(0);

  const address = app.getHttpServer().address() as AddressInfo;
  return { app, baseUrl: `ws://127.0.0.1:${address.port}/yjs` };
}

describe('Presence across realtime instances (e2e)', () => {
  let instanceA: { app: INestApplication; baseUrl: string };
  let instanceB: { app: INestApplication; baseUrl: string };

  beforeAll(async () => {
    [instanceA, instanceB] = await Promise.all([startInstance(), startInstance()]);
  });

  afterAll(async () => {
    await Promise.all([instanceA.app.close(), instanceB.app.close()]);
  });

  it('relays a presence update from a client on one instance to a client on another', async () => {
    const boardId = `presence-${Date.now()}-relay`;
    const clientA = new TestPresenceClient(boardUrl(instanceA.baseUrl, boardId));
    const clientB = new TestPresenceClient(boardUrl(instanceB.baseUrl, boardId));
    await Promise.all([clientA.waitForOpen(), clientB.waitForOpen()]);

    clientA.setState({ name: 'Ada', cursor: { x: 1, y: 2 } });

    await waitUntil(
      () => clientB.awareness.getStates().get(clientA.awareness.clientID) !== undefined,
    );
    expect(clientB.awareness.getStates().get(clientA.awareness.clientID)).toEqual({
      name: 'Ada',
      cursor: { x: 1, y: 2 },
    });

    clientA.close();
    clientB.close();
  });

  it('sends a snapshot of existing presence to a client newly joining on a different instance', async () => {
    const boardId = `presence-${Date.now()}-snapshot`;
    const clientA = new TestPresenceClient(boardUrl(instanceA.baseUrl, boardId));
    await clientA.waitForOpen();
    clientA.setState({ name: 'Grace' });

    // Give the update time to persist to Redis before anyone new joins.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const clientC = new TestPresenceClient(boardUrl(instanceB.baseUrl, boardId));
    await clientC.waitForOpen();

    await waitUntil(
      () => clientC.awareness.getStates().get(clientA.awareness.clientID) !== undefined,
    );
    expect(clientC.awareness.getStates().get(clientA.awareness.clientID)).toEqual({
      name: 'Grace',
    });

    clientA.close();
    clientC.close();
  });

  it('removes a client that drops without a close frame, for peers on both instances and for later joiners', async () => {
    const boardId = `presence-${Date.now()}-ghost`;
    const ghost = new TestPresenceClient(boardUrl(instanceA.baseUrl, boardId));
    const peerSameInstance = new TestPresenceClient(boardUrl(instanceA.baseUrl, boardId));
    const peerOtherInstance = new TestPresenceClient(boardUrl(instanceB.baseUrl, boardId));
    await Promise.all([
      ghost.waitForOpen(),
      peerSameInstance.waitForOpen(),
      peerOtherInstance.waitForOpen(),
    ]);
    ghost.setState({ name: 'Ghost' });
    await waitUntil(
      () =>
        peerSameInstance.remoteClientIds().includes(ghost.awareness.clientID) &&
        peerOtherInstance.remoteClientIds().includes(ghost.awareness.clientID),
    );

    ghost.terminate();

    await waitUntil(
      () =>
        !peerSameInstance.remoteClientIds().includes(ghost.awareness.clientID) &&
        !peerOtherInstance.remoteClientIds().includes(ghost.awareness.clientID),
    );

    // A client joining afterwards is caught up from Valkey and must not be told about the ghost.
    const late = new TestPresenceClient(boardUrl(instanceB.baseUrl, boardId));
    await late.waitForOpen();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(late.remoteClientIds()).not.toContain(ghost.awareness.clientID);

    peerSameInstance.close();
    peerOtherInstance.close();
    late.close();
  });
});
