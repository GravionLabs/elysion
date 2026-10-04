import type { SceneSnapshot } from './minimap-geometry';

/**
 * Holds the latest canvas snapshot outside React state, so a drag on the canvas re-renders only the
 * components that subscribe (the minimap), not `CanvasApp` and Excalidraw with it.
 */
export class SceneStore {
  #snapshot: SceneSnapshot | null = null;
  readonly #listeners = new Set<() => void>();

  readonly get = (): SceneSnapshot | null => this.#snapshot;

  readonly set = (snapshot: SceneSnapshot): void => {
    this.#snapshot = snapshot;
    this.#listeners.forEach((listener) => listener());
  };

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
}
