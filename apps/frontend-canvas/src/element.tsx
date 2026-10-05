import { type Root, createRoot } from 'react-dom/client';
import { CanvasApp, type CanvasControls } from './CanvasApp';
import type { ExportFormat, ExportOptions } from './board-io';
import { parseTheme } from './useResolvedTheme';

export const ELEMENT_TAG_NAME = 'elysion-canvas';

const OBSERVED_ATTRIBUTES = ['board-id', 'yjs-server-url', 'theme'] as const;

class ElysionCanvasElement extends HTMLElement {
  static get observedAttributes(): readonly string[] {
    return OBSERVED_ATTRIBUTES;
  }

  #root: Root | null = null;
  #controls: CanvasControls | null = null;

  connectedCallback(): void {
    this.#root = createRoot(this);
    this.#render();
    this.dispatchEvent(new CustomEvent('ready', { bubbles: true, composed: true }));
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
