import { type Root, createRoot } from 'react-dom/client';
import { CanvasApp } from './CanvasApp';
import { parseTheme } from './useResolvedTheme';

export const ELEMENT_TAG_NAME = 'elysion-canvas';

const OBSERVED_ATTRIBUTES = ['board-id', 'yjs-server-url', 'theme'] as const;

class ElysionCanvasElement extends HTMLElement {
  static get observedAttributes(): readonly string[] {
    return OBSERVED_ATTRIBUTES;
  }

  #root: Root | null = null;

  connectedCallback(): void {
    this.#root = createRoot(this);
    this.#render();
    this.dispatchEvent(new CustomEvent('ready', { bubbles: true, composed: true }));
  }

  disconnectedCallback(): void {
    this.#root?.unmount();
    this.#root = null;
  }

  attributeChangedCallback(): void {
    this.#render();
  }

  #emit(name: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  #render(): void {
    this.#root?.render(
      <CanvasApp
        onStatusChange={(status) => this.#emit('status', { status })}
        onThemeChange={(theme) => this.#emit('themechange', { theme })}
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
