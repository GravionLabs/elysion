import { type Root, createRoot } from 'react-dom/client';
import { CanvasApp, type CanvasControls } from './CanvasApp';
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
