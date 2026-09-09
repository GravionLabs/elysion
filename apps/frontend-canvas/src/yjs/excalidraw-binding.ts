import { CaptureUpdateAction, reconcileElements } from '@excalidraw/excalidraw';
import type { RemoteExcalidrawElement } from '@excalidraw/excalidraw/data/reconcile';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import * as Y from 'yjs';

const ELEMENTS_MAP_KEY = 'elements';

/**
 * Binds an Excalidraw scene to a shared Y.Doc: local edits are written into
 * a Y.Map<elementId, element> (never removed — Excalidraw already
 * soft-deletes via `isDeleted`, which doubles as a CRDT-friendly
 * tombstone), and remote map changes are merged back into the scene with
 * Excalidraw's own `reconcileElements` so an in-progress local edit never
 * gets clobbered by an incoming remote update.
 *
 * Feedback loops are avoided without an "applying remote update" flag: a
 * remote-applied element keeps the version number it arrived with, so the
 * next local onChange sees `version` unchanged and skips writing it back.
 */
export class ExcalidrawYjsBinding {
  readonly #doc: Y.Doc;
  readonly #elements: Y.Map<OrderedExcalidrawElement>;
  #api: ExcalidrawImperativeAPI | null = null;

  constructor(doc: Y.Doc) {
    this.#doc = doc;
    this.#elements = doc.getMap<OrderedExcalidrawElement>(ELEMENTS_MAP_KEY);
    this.#elements.observe(this.#handleRemoteChange);
  }

  attach(api: ExcalidrawImperativeAPI): void {
    this.#api = api;
    this.#handleRemoteChange();
  }

  destroy(): void {
    this.#elements.unobserve(this.#handleRemoteChange);
    this.#api = null;
  }

  onLocalChange = (elements: readonly OrderedExcalidrawElement[]): void => {
    this.#doc.transact(() => {
      for (const element of elements) {
        const existing = this.#elements.get(element.id);
        if (!existing || existing.version < element.version) {
          // Excalidraw mutates its element objects in place; Y.Map.get()
          // returns the exact reference passed to .set(), so storing
          // `element` directly would make `existing` and `element` alias
          // the same object — the version comparison above would then
          // always read as "equal" (both sides mutate together) after the
          // first write, silently dropping every later update. Clone to
          // freeze a snapshot of this version.
          this.#elements.set(element.id, structuredClone(element));
        }
      }
    });
  };

  #handleRemoteChange = (): void => {
    const api = this.#api;
    if (!api) {
      return;
    }

    const localElements = api.getSceneElementsIncludingDeleted();
    const remoteElements = Array.from(this.#elements.values()) as RemoteExcalidrawElement[];
    const reconciled = reconcileElements(localElements, remoteElements, api.getAppState());

    api.updateScene({ elements: reconciled, captureUpdate: CaptureUpdateAction.NEVER });
  };
}
