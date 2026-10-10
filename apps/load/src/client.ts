import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync.js';
import * as Y from 'yjs';
import WebSocket from 'ws';

const MESSAGE_SYNC = 0;
const MESSAGE_BOARD_FULL = 4;
const REMOTE = 'remote';

/** What a client counts; the runner adds them up. */
export interface ClientEvents {
  /** An update of another client arrived `ms` after it was written (one clock: the runner and the clients share a machine). */
  onLatency(ms: number): void;
  onConnected(): void;
  /** The socket went away; `code` is the close code. */
  onClosed(code: number, wasOpen: boolean): void;
  onBoardFull(): void;
}

export interface ClientOptions {
  boardId: string;
  index: number;
  url: string;
  wsToken: () => Promise<string>;
  /** How often this client moves its element, in ms. */
  writeEveryMs: number;
  events: ClientEvents;
}

/** The element a client moves: what it writes carries the time, who wrote it and a counter. */
interface Moved {
  writer: number;
  n: number;
  ts: number;
}

/**
 * One simulated person on a board: speaks the sync protocol the canvas speaks, moves its own element every
 * `writeEveryMs`, measures how long the elements of the others take to arrive, and reconnects with a growing delay when
 * the socket goes away (a new token each time, as the shell does). The document is kept across reconnects, like a tab does.
 */
export class LoadClient {
  readonly doc = new Y.Doc();
  /** The counter of the last write: what the final document must hold for this client. */
  written = 0;
  reconnects = 0;
  #socket: WebSocket | null = null;
  #writer: NodeJS.Timeout | undefined;
  #retry: NodeJS.Timeout | undefined;
  #stopped = false;
  #attempt = 0;
  #syncedAt = 0;
  readonly #seen = new Map<string, number>();

  constructor(private readonly options: ClientOptions) {
    const elements = this.doc.getMap<Moved>('elements');
    elements.observe((event) => {
      if (event.transaction.origin !== REMOTE || Date.now() - this.#syncedAt < 1_000) return;
      for (const key of event.keysChanged) {
        const value = elements.get(key);
        if (!value || value.writer === this.options.index) continue;
        if (value.n > (this.#seen.get(key) ?? 0)) {
          this.#seen.set(key, value.n);
          this.options.events.onLatency(Date.now() - value.ts);
        }
      }
    });
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE) return;
      this.#send((encoder) => syncProtocol.writeUpdate(encoder, update));
    });
  }

  start(): void {
    void this.#connect();
    this.#writer = setInterval(() => this.#write(), this.options.writeEveryMs);
  }

  /** Stops writing but stays connected, so that the last updates reach the server. */
  stopWriting(): void {
    clearInterval(this.#writer);
  }

  stop(): void {
    this.#stopped = true;
    clearInterval(this.#writer);
    clearTimeout(this.#retry);
    this.#socket?.close();
  }

  /** Drops the connection and connects again at once, like a network change. */
  reconnectNow(): void {
    this.#socket?.terminate();
  }

  get connected(): boolean {
    return this.#socket?.readyState === WebSocket.OPEN;
  }

  #write(): void {
    this.written += 1;
    const index = this.options.index;
    const value: Moved = { writer: index, n: this.written, ts: Date.now() };
    this.doc.getMap<Moved>('elements').set(`c${index}`, value);
  }

  async #connect(): Promise<void> {
    if (this.#stopped) return;
    let token: string;
    try {
      token = await this.options.wsToken();
    } catch {
      return this.#scheduleRetry();
    }
    if (this.#stopped) return;
    const url = new URL(this.options.url);
    url.searchParams.set('board', this.options.boardId);
    url.searchParams.set('token', token);
    const socket = new WebSocket(url);
    this.#socket = socket;
    let opened = false;
    socket.binaryType = 'nodebuffer';
    socket.on('open', () => {
      opened = true;
      this.#attempt = 0;
      this.options.events.onConnected();
      this.#send((encoder) => syncProtocol.writeSyncStep1(encoder, this.doc));
    });
    socket.on('message', (data: Buffer) => this.#handle(new Uint8Array(data)));
    socket.on('error', () => undefined);
    socket.on('close', (code) => {
      if (!this.#stopped) this.options.events.onClosed(code, opened);
      if (this.#socket === socket) this.#socket = null;
      this.#scheduleRetry();
    });
  }

  #scheduleRetry(): void {
    if (this.#stopped) return;
    this.reconnects += 1;
    const delay = Math.min(500 * 2 ** Math.min(this.#attempt, 4), 8_000) * (0.5 + Math.random());
    this.#attempt += 1;
    this.#retry = setTimeout(() => void this.#connect(), delay);
  }

  #handle(message: Uint8Array): void {
    const decoder = decoding.createDecoder(message);
    const type = decoding.readVarUint(decoder);
    if (type === MESSAGE_BOARD_FULL) {
      this.options.events.onBoardFull();
      return;
    }
    if (type !== MESSAGE_SYNC) return;
    const isStep2 = decoding.peekVarUint(decoder) === syncProtocol.messageYjsSyncStep2;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.readSyncMessage(decoder, encoder, this.doc, REMOTE);
    if (encoding.length(encoder) > 1) this.#raw(encoding.toUint8Array(encoder));
    if (isStep2) this.#syncedAt = Date.now();
  }

  #send(write: (encoder: encoding.Encoder) => void): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    write(encoder);
    this.#raw(encoding.toUint8Array(encoder));
  }

  #raw(bytes: Uint8Array): void {
    if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(bytes);
  }
}

/** Opens a board's document once, reads it and closes: what a person who opens the board sees. */
export async function readDocument(
  url: string,
  boardId: string,
  token: string,
  timeoutMs = 20_000,
): Promise<Record<string, Moved>> {
  const doc = new Y.Doc();
  const target = new URL(url);
  target.searchParams.set('board', boardId);
  target.searchParams.set('token', token);
  const socket = new WebSocket(target);
  const send = (write: (encoder: encoding.Encoder) => void) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    write(encoder);
    if (socket.readyState === WebSocket.OPEN) socket.send(encoding.toUint8Array(encoder));
  };
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`the document of ${boardId} did not sync`)),
      timeoutMs,
    );
    socket.on('error', reject);
    socket.on('open', () => send((encoder) => syncProtocol.writeSyncStep1(encoder, doc)));
    socket.on('message', (data: Buffer) => {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return;
      const isStep2 = decoding.peekVarUint(decoder) === syncProtocol.messageYjsSyncStep2;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, encoder, doc, REMOTE);
      if (encoding.length(encoder) > 1 && socket.readyState === WebSocket.OPEN) {
        socket.send(encoding.toUint8Array(encoder));
      }
      if (isStep2) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  socket.close();
  return doc.getMap<Moved>('elements').toJSON();
}
