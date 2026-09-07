import { Injectable, InjectionToken } from '@angular/core';

/**
 * URL of the bundled <elysion-canvas> custom element script (built from
 * apps/frontend-canvas, see its `build:element` script). Overridable per
 * environment; defaults to the path the Angular build copies it to.
 */
export const CANVAS_ELEMENT_SRC = new InjectionToken<string>('CANVAS_ELEMENT_SRC', {
  factory: () => '/canvas/elysion-canvas.js',
});

/**
 * Loads the <elysion-canvas> custom element's script tag exactly once per
 * page, however many Board instances mount. Custom elements upgrade any
 * matching tags already in the DOM once `customElements.define` runs, so
 * callers don't need to wait for this before rendering the element.
 */
@Injectable({ providedIn: 'root' })
export class CanvasElementLoader {
  #loadPromise: Promise<void> | null = null;

  load(src: string): Promise<void> {
    this.#loadPromise ??= new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.type = 'module';
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load canvas element script: ${src}`));
      document.head.appendChild(script);
    });
    return this.#loadPromise;
  }
}
