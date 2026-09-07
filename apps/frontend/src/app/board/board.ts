import { CUSTOM_ELEMENTS_SCHEMA, Component, inject, input, signal } from '@angular/core';
import { CANVAS_ELEMENT_SRC, CanvasElementLoader } from './canvas-element-loader';

export type CanvasStatus = 'loading' | 'ready' | 'error';

@Component({
  imports: [],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  selector: 'app-board',
  styleUrl: './board.scss',
  templateUrl: './board.html',
})
export class Board {
  readonly #loader = inject(CanvasElementLoader);
  readonly #canvasElementSrc = inject(CANVAS_ELEMENT_SRC);

  /** Passed to <elysion-canvas> as the `board-id` attribute. */
  readonly boardId = input('default');

  readonly status = signal<CanvasStatus>('loading');

  constructor() {
    this.#loader.load(this.#canvasElementSrc).catch(() => this.status.set('error'));
  }

  onCanvasReady(): void {
    this.status.set('ready');
  }

  onCanvasError(): void {
    this.status.set('error');
  }
}
