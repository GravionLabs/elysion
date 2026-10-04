import { CUSTOM_ELEMENTS_SCHEMA, Component, inject, input } from '@angular/core';
import { BoardStore } from './board.store';
import { CANVAS_ELEMENT_SRC, CanvasElementLoader } from './canvas-element-loader';

export type { CanvasStatus } from './board.store';

@Component({
  imports: [],
  providers: [BoardStore],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  selector: 'app-board',
  styleUrl: './board.scss',
  templateUrl: './board.html',
})
export class Board {
  readonly #store = inject(BoardStore);
  readonly #loader = inject(CanvasElementLoader);
  readonly #canvasElementSrc = inject(CANVAS_ELEMENT_SRC);

  /** Passed to <elysion-canvas> as the `board-id` attribute. */
  readonly boardId = input('default');

  /** Passed to <elysion-canvas> as the `yjs-server-url` attribute; omitted (element uses its own same-origin default) when not set. */
  readonly yjsServerUrl = input<string>();

  /** Passed to <elysion-canvas> as the `theme` attribute; omitted (element follows the system preference) when not set. */
  readonly theme = input<'light' | 'dark'>();

  readonly status = this.#store.status;

  constructor() {
    this.#loader.load(this.#canvasElementSrc).catch(() => this.#store.markError());
  }

  onCanvasReady(): void {
    this.#store.markReady();
  }

  onCanvasError(): void {
    this.#store.markError();
  }
}
