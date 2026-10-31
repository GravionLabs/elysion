import { type Root, createRoot } from 'react-dom/client';
import { CanvasApp, type CanvasControls } from './CanvasApp';
import type { TimerState } from './facilitation/timer';
import type { StartOptions, VotingApi, VotingView } from './facilitation/voting';
import type { OpenedBoard, SnapshotApi, SnapshotInfo } from './history/history';
import type { ExportFormat, ExportOptions } from './board-io';
import { parseTheme } from './useResolvedTheme';
import { parseLocale, createI18n } from './i18n';
import type { FileStore } from './yjs/files';

import type { Person } from './comments/mentions';

export type { FileStore, VotingApi, SnapshotApi, SnapshotInfo, OpenedBoard, Person };

/** The people `@` offers in a comment: asked each time the comments open. */
export type MentionDirectory = () => Promise<readonly Person[]>;

/** The host's search for people by what was typed after `@` (#733). */
export type MentionSearch = (query: string) => Promise<readonly Person[]>;

/** What the host gives the canvas to get a WS token. */
export type TokenProvider = () => Promise<string | null>;

export const ELEMENT_TAG_NAME = 'elysion-canvas';

const OBSERVED_ATTRIBUTES = [
  'board-id',
  'yjs-server-url',
  'theme',
  'locale',
  'user-name',
  'user-id',
  'user-color',
  'readonly',
  'images-enabled',
  'max-elements',
  'can-moderate',
] as const;

class ElysionCanvasElement extends HTMLElement {
  static get observedAttributes(): readonly string[] {
    return OBSERVED_ATTRIBUTES;
  }

  #root: Root | null = null;
  #controls: CanvasControls | null = null;
  #tokenProvider: TokenProvider | undefined;
  #fileStore: FileStore | undefined;
  #votingApi: VotingApi | undefined;
  #snapshotApi: SnapshotApi | undefined;
  #mentionDirectory: MentionDirectory | undefined;
  #mentionSearch: MentionSearch | undefined;

  /**
   * Asked before every connection to the board server for the board-scoped WS token (docs/specs/identity.md): it
   * resolves with the token, or `null` when the host does not want a connection (and has said why itself). A
   * rejection is retried with a growing delay. Not an attribute: it is a function, and a token lives for about a
   * minute, so one given once would be useless at the next reconnect.
   */
  get tokenProvider(): TokenProvider | undefined {
    return this.#tokenProvider;
  }

  set tokenProvider(provider: TokenProvider | undefined) {
    this.#tokenProvider = provider;
    this.#render();
  }

  /**
   * Where the bytes of the board's images are stored (#702): `put(file, id)` and `get(id)`, backed by the host's API.
   * An image is uploaded when it is inserted and only a reference goes into the shared document; the other clients load
   * the file with `get`. A property, like `tokenProvider`, because it is an object with methods. Without one, images
   * stay on the screen they were inserted on, so the host sets `images-enabled` only together with it.
   */
  get fileStore(): FileStore | undefined {
    return this.#fileStore;
  }

  set fileStore(store: FileStore | undefined) {
    this.#fileStore = store;
    this.#render();
  }

  /**
   * How the canvas reaches the board's voting on the server (ADR 0029): `get`, `start`, `vote`, `retract`, `close` and
   * `clear`, backed by the host's API. A property, like `fileStore`, because it is an object with methods. Without one
   * a voting cannot be started or voted in.
   */
  get votingApi(): VotingApi | undefined {
    return this.#votingApi;
  }

  set votingApi(api: VotingApi | undefined) {
    this.#votingApi = api;
    this.#render();
  }

  /**
   * How the canvas reaches the board's versions (#846, ADR 0032): `list`, `create`, `rename`, `remove` and `document`, backed
   * by the host's API. A property because it is an object with methods. Without one the History panel stays unavailable.
   */
  get snapshotApi(): SnapshotApi | undefined {
    return this.#snapshotApi;
  }

  set snapshotApi(api: SnapshotApi | undefined) {
    this.#snapshotApi = api;
    this.#render();
  }

  /**
   * The people `@` offers in a comment (#733): `{id, name}` with the identity provider's id, which is what a mention stores.
   * A property, like `fileStore`, because it is a function. Without one only the authors of earlier comments are offered.
   */
  get mentionDirectory(): MentionDirectory | undefined {
    return this.#mentionDirectory;
  }

  set mentionDirectory(directory: MentionDirectory | undefined) {
    this.#mentionDirectory = directory;
    this.#render();
  }

  /**
   * The host's search for people, used for `@` once two characters are typed (after a short rest): `search(query)` resolves with
   * `{id, name}` entries, the same ids as {@link mentionDirectory}. A property because it is a function. Without one only the
   * directory is offered; a rejection leaves the directory's list as it is.
   */
  get mentionSearch(): MentionSearch | undefined {
    return this.#mentionSearch;
  }

  set mentionSearch(search: MentionSearch | undefined) {
    this.#mentionSearch = search;
    this.#render();
  }

  connectedCallback(): void {
    // A host may set properties on the element before it is upgraded (the script loads lazily, so on the first visit
    // the element can exist before this class does). That leaves an own property that hides the accessor above, and
    // the value would never arrive: move it onto the accessor.
    this.#adoptEarlyProperty('tokenProvider');
    this.#adoptEarlyProperty('fileStore');
    this.#adoptEarlyProperty('votingApi');
    this.#adoptEarlyProperty('snapshotApi');
    this.#adoptEarlyProperty('mentionDirectory');
    this.#adoptEarlyProperty('mentionSearch');
    this.#root = createRoot(this);
    this.#render();
    this.dispatchEvent(new CustomEvent('ready', { bubbles: true, composed: true }));
  }

  #adoptEarlyProperty(
    name:
      | 'tokenProvider'
      | 'fileStore'
      | 'votingApi'
      | 'snapshotApi'
      | 'mentionDirectory'
      | 'mentionSearch',
  ): void {
    if (Object.prototype.hasOwnProperty.call(this, name)) {
      const value = (this as unknown as Record<string, unknown>)[name];
      delete (this as unknown as Record<string, unknown>)[name];
      if (name === 'tokenProvider') {
        this.tokenProvider = value as TokenProvider | undefined;
      } else if (name === 'fileStore') {
        this.fileStore = value as FileStore | undefined;
      } else if (name === 'votingApi') {
        this.votingApi = value as VotingApi | undefined;
      } else if (name === 'snapshotApi') {
        this.snapshotApi = value as SnapshotApi | undefined;
      } else if (name === 'mentionDirectory') {
        this.mentionDirectory = value as MentionDirectory | undefined;
      } else {
        this.mentionSearch = value as MentionSearch | undefined;
      }
    }
  }

  disconnectedCallback(): void {
    this.#root?.unmount();
    this.#root = null;
    this.#controls = null;
  }

  attributeChangedCallback(): void {
    this.#render();
  }

  /** Opens the library sidebar, or closes it when it is open. Does nothing before the canvas is ready. */
  toggleLibrary(): void {
    this.#controls?.toggleLibrary();
  }

  /**
   * The board as the picture of its card (#729): a 480 by 300 PNG in the light theme, or `null` when the board is empty or the
   * canvas is not up. The shell uploads it when an editor leaves the board.
   */
  exportThumbnail(): Promise<Blob | null> {
    return this.#controls ? this.#controls.exportThumbnail() : Promise.resolve(null);
  }

  /**
   * Resolves when the images of the board are loaded (nothing is being fetched or uploaded any more) or after at most
   * `timeoutMs` (20 seconds). A host that makes an export of a board it does not show waits for it after `synced`.
   */
  whenSettled(timeoutMs?: number): Promise<void> {
    return this.#controls ? this.#controls.whenSettled(timeoutMs) : Promise.resolve();
  }

  /** The board (or the selection) as a file, or `null` when there is nothing to export or the canvas is not up. */
  exportBoard(format: ExportFormat, options?: ExportOptions): Promise<Blob | null> {
    return this.#controls ? this.#controls.exportBoard(format, options) : Promise.resolve(null);
  }

  /** Replaces the board with an .excalidraw file; rejects when the file is not one or the canvas is not up. */
  importFile(file: Blob): Promise<number> {
    return this.#controls
      ? this.#controls.importFile(file)
      : Promise.reject(new Error(this.#notReady()));
  }

  /**
   * Opens the PDF import (#725): a dialog with the pages of the PDF, then one picture in a frame per chosen page, in one undo
   * step. Resolves with the number of pages put on the board, `0` when it was canceled; rejects on a read-only canvas, on a
   * board that cannot take pictures and before the canvas is up.
   */
  importPdf(file: Blob): Promise<number> {
    return this.#controls
      ? this.#controls.importPdf(file)
      : Promise.reject(new Error(this.#notReady()));
  }

  /** Adds an .excalidraw file to the board with fresh ids, at the middle of the view, and selects it; one undo step. Resolves with the number of elements added. */
  insertFile(file: Blob): Promise<number> {
    return this.#controls
      ? this.#controls.insertFile(file)
      : Promise.reject(new Error(this.#notReady()));
  }

  /**
   * Follows a person (#848), by the `id` of an entry of the `presence` event: the canvas shows what their window shows until
   * they pan, zoom or press Esc, or the person leaves. Rejects when they are not on the board or have not shown a view yet.
   */
  follow(userId: string): Promise<void> {
    return this.#timer((controls) => controls.follow(userId));
  }

  /** Ends following (what Esc does). */
  stopFollowing(): Promise<void> {
    return this.#timer((controls) => controls.stopFollowing());
  }

  /** Goes back into the presentation this person stepped out of. */
  followPresenter(): Promise<void> {
    return this.#timer((controls) => controls.followPresenter());
  }

  /** Makes this person the presenter: everybody follows them while they are on the board. Editors and owners; rejects on a read-only canvas. */
  startPresenting(): Promise<void> {
    return this.#timer((controls) => controls.startPresenting());
  }

  /** Ends the presentation (the presenter, or an owner: `can-moderate`). */
  stopPresenting(): Promise<void> {
    return this.#timer((controls) => controls.stopPresenting());
  }

  /** "Bring everyone to me": everybody else's view jumps once to this one, without following. Editors and owners. */
  summonEveryone(): Promise<void> {
    return this.#timer((controls) => controls.summonEveryone());
  }

  /** Starts a shared countdown of `durationMs` for everybody on the board; rejects on a read-only canvas or before it is up. */
  startTimer(durationMs: number): Promise<void> {
    return this.#timer((controls) => controls.startTimer(durationMs));
  }

  /** Pauses the shared timer. */
  pauseTimer(): Promise<void> {
    return this.#timer((controls) => controls.pauseTimer());
  }

  /** Lets a paused shared timer run on. */
  resumeTimer(): Promise<void> {
    return this.#timer((controls) => controls.resumeTimer());
  }

  /** Adds `ms` to the shared timer. */
  extendTimer(ms: number): Promise<void> {
    return this.#timer((controls) => controls.extendTimer(ms));
  }

  /** Removes the shared timer for everybody. */
  stopTimer(): Promise<void> {
    return this.#timer((controls) => controls.stopTimer());
  }

  /** Opens a dot voting for everybody on the board (`named` shows who voted for what in the result); rejects while one is open, on a read-only canvas, without a `votingApi` and before the canvas is up. */
  startVoting(options: StartOptions): Promise<void> {
    return this.#timer((controls) => controls.startVoting(options));
  }

  /** Closes the open voting and shows the result; a no-op when none is open. */
  endVoting(): Promise<void> {
    return this.#timer((controls) => controls.endVoting());
  }

  /** Removes the results: every closed voting with its votes; an open one stays. */
  clearVotingResults(): Promise<void> {
    return this.#timer((controls) => controls.clearVotingResults());
  }

  /** Scrolls the view to an element, for the results panel; rejects when the element is not on the board. */
  scrollToElement(elementId: string): Promise<void> {
    return this.#timer((controls) => controls.scrollToElement(elementId));
  }

  #timer(run: (controls: CanvasControls) => Promise<void>): Promise<void> {
    return this.#controls ? run(this.#controls) : Promise.reject(new Error(this.#notReady()));
  }

  #notReady(): string {
    return createI18n(parseLocale(this.getAttribute('locale'))).t.errorNotReady;
  }

  #emit(name: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  #render(): void {
    this.#root?.render(
      <CanvasApp
        onStatusChange={(status) => this.#emit('status', { status })}
        onThemeChange={(theme) => this.#emit('themechange', { theme })}
        onControls={(controls) => (this.#controls = controls)}
        onLibraryChange={(open) => this.#emit('librarychange', { open })}
        onSelectionCount={(count) => this.#emit('selectioncount', { count })}
        onPresenceChange={(users) => this.#emit('presence', { users })}
        onFollowChange={(state) => this.#emit('follow', state)}
        onTimerChange={(state: TimerState | null) => this.#emit('timer', { state })}
        onVotingChange={(session: VotingView | null) => this.#emit('voting', { session })}
        onCommentsChange={(summary) => this.#emit('comments', summary)}
        onError={(error) => this.#emit('error', { message: error.message })}
        onOfflineChange={(state) => this.#emit('offline', state)}
        onNotice={(message) => this.#emit('notice', { message })}
        onOpenBoard={(board) => this.#emit('openboard', board)}
        onFileError={(error) => this.#emit('fileerror', { message: error.message })}
        onSynced={() => this.#emit('synced', {})}
        tokenProvider={this.#tokenProvider}
        fileStore={this.#fileStore}
        votingApi={this.#votingApi}
        snapshotApi={this.#snapshotApi}
        mentionDirectory={this.#mentionDirectory}
        mentionSearch={this.#mentionSearch}
        canModerate={this.hasAttribute('can-moderate')}
        readOnly={this.hasAttribute('readonly')}
        imagesEnabled={this.hasAttribute('images-enabled')}
        maxElements={positiveInteger(this.getAttribute('max-elements'))}
        userName={this.getAttribute('user-name') ?? undefined}
        userId={this.getAttribute('user-id') ?? undefined}
        userColor={this.getAttribute('user-color') ?? undefined}
        boardId={this.getAttribute('board-id') ?? undefined}
        yjsServerUrl={this.getAttribute('yjs-server-url') ?? undefined}
        theme={parseTheme(this.getAttribute('theme'))}
        locale={parseLocale(this.getAttribute('locale'))}
      />,
    );
  }
}

/** The attribute as a positive whole number, or `undefined` (use the default). */
function positiveInteger(value: string | null): number | undefined {
  const number = Number(value);
  return value !== null && Number.isInteger(number) && number > 0 ? number : undefined;
}

export function registerElysionCanvasElement(): void {
  if (!customElements.get(ELEMENT_TAG_NAME)) {
    customElements.define(ELEMENT_TAG_NAME, ElysionCanvasElement);
  }
}

registerElysionCanvasElement();
