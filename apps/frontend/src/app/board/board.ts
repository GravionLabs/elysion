import { CUSTOM_ELEMENTS_SCHEMA, Component, inject } from '@angular/core';
import { CANVAS_ELEMENT_SRC, CanvasElementLoader } from './canvas-element-loader';

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

  constructor() {
    void this.#loader.load(this.#canvasElementSrc);
  }
}
