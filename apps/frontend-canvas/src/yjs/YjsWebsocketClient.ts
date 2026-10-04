import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { MESSAGE_SYNC } from './protocol.js';

export type YjsConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface YjsWebsocketClientOptions {
  /** @default 1000 */
  reconnectDelayMs?: number;
  onStatusChange?: (status: YjsConnectionStatus) => void;
  /**
   * Overrides the WebSocket constructor used to connect — the global
   * `WebSocket` by default. Mainly for tests: Node's native `WebSocket`
   * (undici) has a `dispatchEvent`/realm mismatch with jsdom's swapped-in
   * `Event`/`EventTarget` globals that throws on close; injecting `ws`'s
   * WebSocket class avoids it.
   */
  WebSocketImpl?: typeof WebSocket;
}

/**
 * Speaks the same sync sub-protocol as apps/realtime's YjsGateway over a
 * plain WebSocket. Not y-websocket's WebsocketProvider: that client always
 * appends its room name as a URL path segment, which the gateway can't
 * route (WsAdapter matches ws upgrades to a gateway by exact pathname, no
 * wildcard support) — the board id here must already be part of `url`
 * (typically as a `?board=` query param, matching the gateway).
 *
 * Presence/awareness (message type 1, Feature #17) isn't handled — this
 * client only keeps the doc in sync.
 */
export class YjsWebsocketClient {
  readonly doc: Y.Doc;

  #url: string;
  #socket: WebSocket | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #reconnectDelayMs: number;
  #destroyed = false;
  #onStatusChange?: (status: YjsConnectionStatus) => void;
  #WebSocketImpl: typeof WebSocket;

  constructor(url: string, doc: Y.Doc = new Y.Doc(), options: YjsWebsocketClientOptions = {}) {
    this.#url = url;
    this.doc = doc;
    this.#reconnectDelayMs = options.reconnectDelayMs ?? 1000;
    this.#onStatusChange = options.onStatusChange;
    this.#WebSocketImpl = options.WebSocketImpl ?? WebSocket;

    this.doc.on('update', this.#handleLocalUpdate);
    this.#connect();
  }

  destroy(): void {
    this.#destroyed = true;
    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer);
    }
    this.doc.off('update', this.#handleLocalUpdate);
    this.#socket?.close();
    this.#socket = null;
  }

  #connect(): void {
    if (this.#destroyed) {
      return;
    }

    this.#onStatusChange?.('connecting');
    const socket = new this.#WebSocketImpl(this.#url);
    socket.binaryType = 'arraybuffer';
    this.#socket = socket;

    socket.addEventListener('open', () => {
      this.#onStatusChange?.('connected');
      // The server sends its own sync-step-1 on connect too (see
      // YjsGateway), but that only tells it what WE'RE missing. Send ours
      // so it can compute and send back what IT has that we don't — without
      // this, a client joining a room with existing history never
      // receives it.
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, this.doc);
      this.#send(encoding.toUint8Array(encoder));
    });
    socket.addEventListener('message', (event) =>
      this.#handleMessage(new Uint8Array(event.data as ArrayBuffer)),
    );
    socket.addEventListener('close', () => {
      this.#onStatusChange?.('disconnected');
      this.#scheduleReconnect();
    });
    socket.addEventListener('error', () => socket.close());
  }

  #scheduleReconnect(): void {
    if (this.#destroyed || this.#reconnectTimer !== null) {
      return;
    }
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#connect();
    }, this.#reconnectDelayMs);
  }

  #handleMessage(message: Uint8Array): void {
    const decoder = decoding.createDecoder(message);
    const messageType = decoding.readVarUint(decoder);
    if (messageType !== MESSAGE_SYNC) {
      return;
    }

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
    if (encoding.length(encoder) > 1) {
      this.#send(encoding.toUint8Array(encoder));
    }
  }

  #handleLocalUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === this) {
      return; // an update we just applied FROM the server — don't echo it back
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.#send(encoding.toUint8Array(encoder));
  };

  #send(message: Uint8Array): void {
    if (this.#socket?.readyState === this.#WebSocketImpl.OPEN) {
      this.#socket.send(new Uint8Array(message).buffer);
    }
  }
}
