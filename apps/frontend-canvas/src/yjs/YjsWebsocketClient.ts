import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { MESSAGE_AWARENESS, MESSAGE_BOARD_FULL, MESSAGE_SYNC } from './protocol.js';

/** The longest wait between attempts to get a token. */
const MAX_BACKOFF_MS = 30_000;

/** The URL with `name` as a query parameter, replacing one that is there. */
function withParam(url: string, name: string, value: string): string {
  try {
    const result = new URL(url);
    result.searchParams.set(name, value);
    return result.toString();
  } catch {
    return `${url}${url.includes('?') ? '&' : '?'}${name}=${encodeURIComponent(value)}`;
  }
}

/** The code the gateway closes a socket with when it cannot load the board (apps/realtime). */
const SERVER_ERROR_CLOSE_CODE = 1011;
/** The gateway refused a message that was too big: an update over the size of one update (ADR 0026). */
const MESSAGE_TOO_BIG_CLOSE_CODE = 1009;
/** The document was rebuilt while this client was away (`WS_CLOSE_STALE_COPY` of @elysion/shared-types, ADR 0026). */
const STALE_COPY_CLOSE_CODE = 4409;

/** The key of the document's generation: `meta.generation` (apps/realtime `generation.ts`). */
const META_MAP_KEY = 'meta';
const GENERATION_KEY = 'generation';

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
   * Asked before every connection attempt, the first and each reconnect, for the token to put on the URL as
   * `?token=` (the board-scoped WS token, which lives for about a minute, so one fetched once would be useless
   * at the next reconnect). It resolves with the token; `undefined` when no token is needed (a gateway without
   * authentication); `null` when the host does not want a connection (it has shown why, e.g. no access any
   * more): the client then stays disconnected and does not retry. A rejection is a failure to get a token
   * (the network, the BFF): it is reported once per outage and retried with a growing delay.
   */
  tokenProvider?: () => Promise<string | null | undefined>;
  /**
   * The server's state of the board has arrived (sync step 2 after a connect): from here on what the document holds is
   * what the board holds, so a host may write what it has that the board lacks. Called after every (re)connect.
   */
  onSynced?: () => void;
  /**
   * The document was rebuilt while this client was away (close code 4409, ADR 0026): this client's `Y.Doc` must not be
   * merged into the new one. The client does not reconnect; the host throws the document away, makes a new client and
   * writes what its scene holds into the new document.
   */
  onStaleCopy?: () => void;
  /** The server refused an update because the board is full (message type 4). */
  onBoardFull?: () => void;
  /** The server closed the connection because an update was larger than one update may be (1009). */
  onUpdateTooLarge?: () => void;
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
  #tokenProvider?: () => Promise<string | null | undefined>;
  #tokenFailures = 0;
  #WebSocketImpl: typeof WebSocket;
  #options: YjsWebsocketClientOptions;
  /** The generation of the document this copy comes from (`''`: it had none): sent on every reconnect, so a rebuilt document is noticed. */
  #generation: string | undefined;

  constructor(url: string, doc: Y.Doc = new Y.Doc(), options: YjsWebsocketClientOptions = {}) {
    this.#url = url;
    this.#options = options;
    this.doc = doc;
    this.#reconnectDelayMs = options.reconnectDelayMs ?? 1000;
    this.#onStatusChange = options.onStatusChange;
    this.#onError = options.onError;
    this.#tokenProvider = options.tokenProvider;
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
    void this.#open();
  }

  /** Gets a token if there is a provider, then opens the socket with it. */
  async #open(): Promise<void> {
    let token: string | null | undefined;
    if (this.#tokenProvider) {
      try {
        token = await this.#tokenProvider();
      } catch {
        if (this.#destroyed) {
          return;
        }
        this.#tokenFailures += 1;
        this.#reportFailure('Could not get a token for the board.');
        this.#onStatusChange?.('disconnected');
        // 1x, 2x, 4x ... the normal delay, at most 30 s: the BFF may be down or the user may have lost access.
        this.#scheduleReconnect(
          Math.min(this.#reconnectDelayMs * 2 ** (this.#tokenFailures - 1), MAX_BACKOFF_MS),
        );
        return;
      }
    }
    if (this.#destroyed) {
      return;
    }
    if (token === null) {
      this.#onStatusChange?.('disconnected'); // the host does not want a connection; it said why
      return;
    }
    this.#tokenFailures = 0;
    let target = token === undefined ? this.#url : withParam(this.#url, 'token', token);
    if (this.#generation !== undefined) {
      target = withParam(target, 'generation', this.#generation);
    }
    this.#openSocket(target);
  }

  #openSocket(url: string): void {
    const socket = new this.#WebSocketImpl(url);
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
      if (event.code === MESSAGE_TOO_BIG_CLOSE_CODE) {
        this.#options.onUpdateTooLarge?.();
      }
      if (event.code === STALE_COPY_CLOSE_CODE) {
        // Not a failure and no reconnect: this copy is out of date. The host replaces the document.
        this.#onStatusChange?.('disconnected');
        this.#options.onStaleCopy?.();
        return;
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

  #scheduleReconnect(delayMs = this.#reconnectDelayMs): void {
    if (this.#destroyed || this.#reconnectTimer !== null) {
      return;
    }
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#connect();
    }, delayMs);
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
    if (messageType === MESSAGE_BOARD_FULL) {
      this.#options.onBoardFull?.();
      return;
    }
    if (messageType !== MESSAGE_SYNC) {
      return;
    }

    const isStep2 = decoding.peekVarUint(decoder) === syncProtocol.messageYjsSyncStep2;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
    if (encoding.length(encoder) > 1) {
      this.#send(encoding.toUint8Array(encoder));
    }
    if (isStep2) {
      this.#synced();
    }
  }

  /** The server's state has arrived: remember which generation of the document this is, and tell the host. */
  #synced(): void {
    if (this.#generation === undefined) {
      const value = this.doc.getMap<unknown>(META_MAP_KEY).get(GENERATION_KEY);
      this.#generation = typeof value === 'string' ? value : '';
    }
    this.#options.onSynced?.();
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
