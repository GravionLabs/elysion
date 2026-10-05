import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { MESSAGE_AWARENESS, MESSAGE_SYNC } from './protocol.js';

/** The code the gateway closes a socket with when it cannot load the board (apps/realtime). */
const SERVER_ERROR_CLOSE_CODE = 1011;

export type YjsConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface YjsWebsocketClientOptions {
  /** @default 1000 */
  reconnectDelayMs?: number;
  onStatusChange?: (status: YjsConnectionStatus) => void;
  /**
   * The connection failed: the socket could not be opened or broke, or the server closed it because it
   * could not serve the board (close code 1011). Called once per outage, not on every retry, and again
   * only after the connection was up in between. The client keeps retrying on its own.
   */
  onError?: (error: Error) => void;
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
 * Presence/awareness (message type 1) rides on the same socket: `awareness` is the
 * y-protocols `Awareness` of the doc. Callers set their local state on it and read the
 * others' from it; this class sends changes, applies what the server sends (including the
 * snapshot of who is already in the room, pushed on connect), clears the others' states
 * when the connection drops (they are unknown until it is back), and announces the local
 * state again after a reconnect.
 */
export class YjsWebsocketClient {
  readonly doc: Y.Doc;
  /** Who is on the board: the local state is set on it, the others' arrive through the socket. */
  readonly awareness: awarenessProtocol.Awareness;

  #url: string;
  #socket: WebSocket | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #reconnectDelayMs: number;
  #destroyed = false;
  #onStatusChange?: (status: YjsConnectionStatus) => void;
  #onError?: (error: Error) => void;
  #failureReported = false;
  #WebSocketImpl: typeof WebSocket;

  constructor(url: string, doc: Y.Doc = new Y.Doc(), options: YjsWebsocketClientOptions = {}) {
    this.#url = url;
    this.doc = doc;
    this.#reconnectDelayMs = options.reconnectDelayMs ?? 1000;
    this.#onStatusChange = options.onStatusChange;
    this.#onError = options.onError;
    this.#WebSocketImpl = options.WebSocketImpl ?? WebSocket;

    this.awareness = new awarenessProtocol.Awareness(doc);

    this.doc.on('update', this.#handleLocalUpdate);
    this.awareness.on('update', this.#handleAwarenessUpdate);
    this.#connect();
  }

  destroy(): void {
    this.#destroyed = true;
    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer);
    }
    this.doc.off('update', this.#handleLocalUpdate);
    // Tell the others we are gone, as long as the socket is still open (the server also drops our
    // state when the socket closes).
    this.awareness.off('update', this.#handleAwarenessUpdate);
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], 'destroy');
    this.#sendAwareness([this.doc.clientID]);
    this.awareness.destroy();
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
      this.#failureReported = false;
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
      this.#announceAgain();
    });
    socket.addEventListener('message', (event) =>
      this.#handleMessage(new Uint8Array(event.data as ArrayBuffer)),
    );
    socket.addEventListener('close', (event) => {
      if (event.code === SERVER_ERROR_CLOSE_CODE) {
        this.#reportFailure('The server could not serve the board.');
      }
      // Whoever was on the board is unknown until we are connected again.
      const others = [...this.awareness.getStates().keys()].filter(
        (id) => id !== this.doc.clientID,
      );
      awarenessProtocol.removeAwarenessStates(this.awareness, others, this);
      this.#onStatusChange?.('disconnected');
      this.#scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      this.#reportFailure('The connection to the board server failed.');
      socket.close();
    });
  }

  #reportFailure(message: string): void {
    if (this.#failureReported || this.#destroyed) {
      return;
    }
    this.#failureReported = true;
    this.#onError?.(new Error(message));
  }

  /**
   * The server dropped our presence when the old connection closed, and removing a state raises its
   * clock for us by one: an announcement with our old clock would be ignored until our next heartbeat
   * (up to 30 s later). Setting the state twice raises our clock past the server's, and each setting is
   * sent by the update handler.
   */
  #announceAgain(): void {
    const state = this.awareness.getLocalState();
    if (state === null) {
      return;
    }
    this.awareness.setLocalState(state);
    this.awareness.setLocalState(state);
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

    if (messageType === MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(
        this.awareness,
        decoding.readVarUint8Array(decoder),
        this,
      );
      return;
    }
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

  /** Local changes go out; what was applied from the server (origin `this`) does not come back. */
  #handleAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    if (origin === this) {
      return;
    }
    this.#sendAwareness([...added, ...updated, ...removed]);
  };

  #sendAwareness(clientIds: number[]): void {
    if (clientIds.length === 0) {
      return;
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, clientIds),
    );
    this.#send(encoding.toUint8Array(encoder));
  }

  #send(message: Uint8Array): void {
    if (this.#socket?.readyState === this.#WebSocketImpl.OPEN) {
      this.#socket.send(new Uint8Array(message).buffer);
    }
  }
}
