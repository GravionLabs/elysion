import { type Root, createRoot } from 'react-dom/client';
import { CanvasApp, type CanvasControls } from './CanvasApp';
import type { TimerState } from './facilitation/timer';
import type { StartOptions, VotingView } from './facilitation/voting';
import type { ExportFormat, ExportOptions } from './board-io';
import { parseTheme } from './useResolvedTheme';
import { parseLocale, createI18n } from './i18n';
import type { FileStore } from './yjs/files';

export type { FileStore };

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
] as const;

class ElysionCanvasElement extends HTMLElement {
  static get observedAttributes(): readonly string[] {
    return OBSERVED_ATTRIBUTES;
  }

  #root: Root | null = null;
  #controls: CanvasControls | null = null;
  #tokenProvider: TokenProvider | undefined;
  #fileStore: FileStore | undefined;

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

  connectedCallback(): void {
    // A host may set properties on the element before it is upgraded (the script loads lazily, so on the first visit
    // the element can exist before this class does). That leaves an own property that hides the accessor above, and
    // the value would never arrive: move it onto the accessor.
    this.#adoptEarlyProperty('tokenProvider');
    this.#adoptEarlyProperty('fileStore');
    this.#root = createRoot(this);
    this.#render();
    this.dispatchEvent(new CustomEvent('ready', { bubbles: true, composed: true }));
  }

  #adoptEarlyProperty(name: 'tokenProvider' | 'fileStore'): void {
    if (Object.prototype.hasOwnProperty.call(this, name)) {
      const value = (this as unknown as Record<string, unknown>)[name];
      delete (this as unknown as Record<string, unknown>)[name];
      if (name === 'tokenProvider') {
        this.tokenProvider = value as TokenProvider | undefined;
      } else {
        this.fileStore = value as FileStore | undefined;
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

  /** Opens a dot voting for everybody on the board; rejects while one is open, on a read-only canvas and before the canvas is up. */
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
        onTimerChange={(state: TimerState | null) => this.#emit('timer', { state })}
        onVotingChange={(session: VotingView | null) => this.#emit('voting', { session })}
        onError={(error) => this.#emit('error', { message: error.message })}
        onNotice={(message) => this.#emit('notice', { message })}
        onFileError={(error) => this.#emit('fileerror', { message: error.message })}
        onSynced={() => this.#emit('synced', {})}
        tokenProvider={this.#tokenProvider}
        fileStore={this.#fileStore}
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
