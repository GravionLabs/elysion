import { type Root, createRoot } from 'react-dom/client';
import { CanvasApp, type CanvasControls } from './CanvasApp';
import type { TimerState } from './facilitation/timer';
import type { ExportFormat, ExportOptions } from './board-io';
import { parseTheme } from './useResolvedTheme';

/** What the host gives the canvas to get a WS token. */
export type TokenProvider = () => Promise<string | null>;

export const ELEMENT_TAG_NAME = 'elysion-canvas';

const OBSERVED_ATTRIBUTES = [
  'board-id',
  'yjs-server-url',
  'theme',
  'user-name',
  'user-id',
  'user-color',
  'readonly',
] as const;

class ElysionCanvasElement extends HTMLElement {
  static get observedAttributes(): readonly string[] {
    return OBSERVED_ATTRIBUTES;
  }

  #root: Root | null = null;
  #controls: CanvasControls | null = null;
  #tokenProvider: TokenProvider | undefined;

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

  connectedCallback(): void {
    // A host may set properties on the element before it is upgraded (the script loads lazily, so on the first visit
    // the element can exist before this class does). That leaves an own property that hides the accessor above, and
    // the value would never arrive: move it onto the accessor.
    this.#adoptEarlyProperty('tokenProvider');
    this.#root = createRoot(this);
    this.#render();
    this.dispatchEvent(new CustomEvent('ready', { bubbles: true, composed: true }));
  }

  #adoptEarlyProperty(name: 'tokenProvider'): void {
    if (Object.prototype.hasOwnProperty.call(this, name)) {
      const value = (this as unknown as Record<string, unknown>)[name];
      delete (this as unknown as Record<string, unknown>)[name];
      this[name] = value as TokenProvider | undefined;
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

  /** The board (or the selection) as a file, or `null` when there is nothing to export or the canvas is not up. */
  exportBoard(format: ExportFormat, options?: ExportOptions): Promise<Blob | null> {
    return this.#controls ? this.#controls.exportBoard(format, options) : Promise.resolve(null);
  }

  /** Replaces the board with an .excalidraw file; rejects when the file is not one or the canvas is not up. */
  importFile(file: Blob): Promise<number> {
    return this.#controls
      ? this.#controls.importFile(file)
      : Promise.reject(new Error('The canvas is not ready yet.'));
  }

  /** Adds an .excalidraw file to the board with fresh ids, at the middle of the view, and selects it; one undo step. Resolves with the number of elements added. */
  insertFile(file: Blob): Promise<number> {
    return this.#controls
      ? this.#controls.insertFile(file)
      : Promise.reject(new Error('The canvas is not ready yet.'));
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

  #timer(run: (controls: CanvasControls) => Promise<void>): Promise<void> {
    return this.#controls
      ? run(this.#controls)
      : Promise.reject(new Error('The canvas is not ready yet.'));
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
        onError={(error) => this.#emit('error', { message: error.message })}
        tokenProvider={this.#tokenProvider}
        readOnly={this.hasAttribute('readonly')}
        userName={this.getAttribute('user-name') ?? undefined}
        userId={this.getAttribute('user-id') ?? undefined}
        userColor={this.getAttribute('user-color') ?? undefined}
        boardId={this.getAttribute('board-id') ?? undefined}
        yjsServerUrl={this.getAttribute('yjs-server-url') ?? undefined}
        theme={parseTheme(this.getAttribute('theme'))}
      />,
    );
  }
}

export function registerElysionCanvasElement(): void {
  if (!customElements.get(ELEMENT_TAG_NAME)) {
    customElements.define(ELEMENT_TAG_NAME, ElysionCanvasElement);
  }
}

registerElysionCanvasElement();
