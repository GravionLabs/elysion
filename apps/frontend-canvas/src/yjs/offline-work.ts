import { IndexeddbPersistence } from 'y-indexeddb';
import type * as Y from 'yjs';

/**
 * Working through an outage (#735). The Yjs document of the canvas keeps what is drawn while the connection is down and
 * merges it when the connection is back, as long as the tab stays open. This keeps it on the device as well, so that a
 * tab that is closed or reloaded during the outage does not lose it: from the moment the connection breaks (after the
 * board was loaded once) the document is mirrored into IndexedDB (`y-indexeddb`), and the next time the board is open
 * with a connection the stored changes are applied (the normal sync sends them) and the store is removed.
 *
 * **Keyed by board and generation** ([ADR 0026](../../../../docs/adr/0026-board-document-compaction-and-limits.md)): the
 * database is `elysion-board:<boardId>:<generation>`. A document that was rebuilt while the tab was away has a new
 * generation and new client ids; stored updates of the old one would bring back what the rebuild left out, so a store of
 * another generation is thrown away (with a message), never applied. The generation is only known once the server's
 * state is in (the first sync), which is why nothing is stored before that and why a store is only looked at then.
 *
 * What is stored is the document, i.e. the board's content as this tab saw it, never a token or a credential. A viewer
 * (a read-only canvas) stores nothing. When IndexedDB is not available (a private window, blocked storage) everything
 * here is a no-op and the canvas behaves as it did before.
 */
export const OFFLINE_DB_PREFIX = 'elysion-board:';

/** The names of the databases this browser holds, kept apart from IndexedDB because `indexedDB.databases()` is not everywhere. */
const INDEX_KEY = 'elysion.offline-stores';

/** How long the store is kept after the connection is back and the board is in sync, so the stored changes are on their way. */
const CLEAR_DELAY_MS = 3000;

export interface OfflineState {
  /** Whether the connection is down after the board was loaded. */
  offline: boolean;
  /** When the outage began (epoch milliseconds), or `null` while online. */
  since: number | null;
  /** The changes made on this device during the outage. */
  pending: number;
  /** On the first report after the outage: how many changes were pending when the connection came back; else 0. */
  sent: number;
}

export interface OfflineWorkOptions {
  doc: Y.Doc;
  boardId: string;
  /** The origin of the updates the sync client applies from the server: they are not changes of this device. */
  serverOrigin: () => unknown;
  /** Whether this canvas may write (a viewer's may not, and stores nothing). */
  canWrite: () => boolean;
  onChange: (state: OfflineState) => void;
  /** A store was thrown away because the document was rebuilt in the meantime. */
  onDiscarded: () => void;
  /** Overrides, for tests. */
  clearDelayMs?: number;
  now?: () => number;
}

/** The database name for a board and the generation of its document (`''`: the document has none yet). */
export function storeName(boardId: string, generation: string): string {
  return `${OFFLINE_DB_PREFIX}${boardId}:${generation === '' ? '-' : generation}`;
}

function readIndex(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((name): name is string => typeof name === 'string') : [];
  } catch {
    return [];
  }
}

function writeIndex(names: string[]): void {
  try {
    if (names.length === 0) localStorage.removeItem(INDEX_KEY);
    else localStorage.setItem(INDEX_KEY, JSON.stringify(names));
  } catch {
    // Storage blocked: the stores are still found by name when the board is opened again.
  }
}

function remember(name: string): void {
  const names = readIndex();
  if (!names.includes(name)) writeIndex([...names, name]);
}

function forget(name: string): void {
  writeIndex(readIndex().filter((entry) => entry !== name));
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Whether IndexedDB can be opened at all (not in a private window of some browsers). Probed once. */
let available: Promise<boolean> | undefined;
export function indexedDbAvailable(): Promise<boolean> {
  available ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(false);
      const request = indexedDB.open('elysion-probe');
      request.onsuccess = () => {
        request.result.close();
        resolve(true);
      };
      request.onerror = request.onblocked = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
  return available;
}

/** For tests: forget the result of the probe. */
export function resetIndexedDbProbe(): void {
  available = undefined;
}

/**
 * Removes every database of this feature from the browser: all boards, all generations. Called at logout, so the next person
 * on the device finds nothing. Names come from the index and, where the browser can list them, from IndexedDB itself.
 */
export async function clearAllOfflineStores(): Promise<void> {
  const names = new Set(readIndex());
  try {
    for (const database of (await indexedDB.databases?.()) ?? []) {
      if (database.name?.startsWith(OFFLINE_DB_PREFIX)) names.add(database.name);
    }
  } catch {
    // Not listable here: the index has them.
  }
  await Promise.all([...names].map(deleteDatabase));
  writeIndex([]);
}

export class OfflineWork {
  readonly #options: OfflineWorkOptions;
  readonly #delay: number;
  readonly #now: () => number;
  #persistence: IndexeddbPersistence | null = null;
  #name: string | null = null;
  #generation: string | undefined;
  #loaded = false;
  #since: number | null = null;
  #pending = 0;
  #clearTimer: ReturnType<typeof setTimeout> | null = null;
  #destroyed = false;
  #connecting: Promise<void> | null = null;

  constructor(options: OfflineWorkOptions) {
    this.#options = options;
    this.#delay = options.clearDelayMs ?? CLEAR_DELAY_MS;
    this.#now = options.now ?? Date.now;
    options.doc.on('update', this.#onUpdate);
  }

  get offline(): boolean {
    return this.#since !== null;
  }

  /** The changes made on this device since the connection broke. */
  get pending(): number {
    return this.#pending;
  }

  /** The connection broke. Before the board was loaded once there is nothing to keep apart from the empty document. */
  disconnected(): void {
    if (this.#destroyed || !this.#loaded || this.#since !== null) return;
    this.#since = this.#now();
    this.#pending = 0;
    this.#cancelClear();
    this.#report(0);
    void this.#attach();
  }

  /**
   * The server's state is in (after every connect). On the first one the stored changes of an earlier outage are applied
   * and stores of other generations are thrown away; after an outage the report goes back to online.
   */
  async synced(generation: string): Promise<void> {
    if (this.#destroyed) return;
    const first = !this.#loaded;
    this.#loaded = true;
    this.#generation = generation;
    const wasOffline = this.#since !== null;
    const sent = this.#pending;
    this.#since = null;
    this.#pending = 0;
    if (wasOffline) this.#report(sent);

    if (first) await this.#restore(generation);
    if (this.#persistence) this.#scheduleClear();
  }

  /** The document of this tab is out of date (rebuilt on the server): nothing stored for the board may be used. */
  async stale(): Promise<void> {
    this.#cancelClear();
    await this.#detach(true);
    await this.#discardOthers(null);
  }

  destroy(): void {
    this.#destroyed = true;
    this.#options.doc.off('update', this.#onUpdate);
    this.#cancelClear();
    // The store stays: it is what a closed tab leaves behind. It is only closed here.
    const persistence = this.#persistence;
    this.#persistence = null;
    void persistence?.destroy().catch(() => undefined);
  }

  readonly #onUpdate = (_update: Uint8Array, origin: unknown): void => {
    if (this.#since === null || origin === this.#options.serverOrigin()) return;
    if (origin instanceof IndexeddbPersistence) return;
    this.#pending += 1;
    this.#report(0);
  };

  #report(sent: number): void {
    this.#options.onChange({
      offline: this.#since !== null,
      since: this.#since,
      pending: this.#pending,
      sent,
    });
  }

  /** Starts mirroring the document into the store of the current generation. */
  async #attach(): Promise<void> {
    if (this.#persistence || this.#connecting || !this.#options.canWrite()) return;
    const generation = this.#generation;
    if (generation === undefined) return;
    this.#connecting = this.#open(storeName(this.#options.boardId, generation));
    try {
      await this.#connecting;
    } finally {
      this.#connecting = null;
    }
  }

  async #open(name: string): Promise<void> {
    if (!(await indexedDbAvailable()) || this.#destroyed) return;
    try {
      // Creating it loads what an earlier outage left (applied to the document) and stores the document as it is now.
      const persistence = new IndexeddbPersistence(name, this.#options.doc);
      this.#persistence = persistence;
      this.#name = name;
      remember(name);
      await persistence.whenSynced;
    } catch {
      this.#persistence = null;
      this.#name = null;
    }
  }

  /** On the first sync of a tab: the changes an earlier outage left for this generation, and the stores of other ones. */
  async #restore(generation: string): Promise<void> {
    const mine = storeName(this.#options.boardId, generation);
    await this.#discardOthers(mine);
    if (!this.#options.canWrite() || !readIndex().includes(mine)) return;
    await this.#open(mine); // applying what is stored sends it to the server like any other change
  }

  /** Deletes the stores of this board whose generation is not the current one (`keep`), and says so when there were any. */
  async #discardOthers(keep: string | null): Promise<void> {
    const prefix = `${OFFLINE_DB_PREFIX}${this.#options.boardId}:`;
    const others = readIndex().filter((name) => name.startsWith(prefix) && name !== keep);
    if (others.length === 0) return;
    await Promise.all(others.map(deleteDatabase));
    writeIndex(readIndex().filter((name) => !others.includes(name)));
    if (keep !== null) this.#options.onDiscarded();
  }

  #scheduleClear(): void {
    this.#cancelClear();
    this.#clearTimer = setTimeout(() => {
      this.#clearTimer = null;
      void this.#detach(true);
    }, this.#delay);
  }

  #cancelClear(): void {
    if (this.#clearTimer !== null) clearTimeout(this.#clearTimer);
    this.#clearTimer = null;
  }

  async #detach(remove: boolean): Promise<void> {
    const persistence = this.#persistence;
    const name = this.#name;
    this.#persistence = null;
    this.#name = null;
    if (!persistence) return;
    try {
      if (remove) await persistence.clearData();
      else await persistence.destroy();
    } catch {
      // Nothing to do: the next logout or discard removes it.
    }
    if (remove && name) forget(name);
  }
}
