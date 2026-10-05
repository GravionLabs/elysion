import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { CaptureUpdateAction } from '@excalidraw/excalidraw';
import type { Awareness } from 'y-protocols/awareness';
import { toCollaborators } from './collaborators';
import type { PresenceState, SessionIdentity } from './identity';
import { throttle } from './throttle';

/** How often the pointer is published at most: a cursor that moves smoothly needs far fewer than 60 a second. */
export const POINTER_INTERVAL_MS = 50;

type PointerUpdate = {
  pointer: { x: number; y: number; tool: 'pointer' | 'laser' };
  button: 'up' | 'down';
};

/**
 * Connects the awareness of a board with the canvas: this client's identity, pointer and selection go
 * out through the awareness, and the other clients' states become Excalidraw's `collaborators`, so
 * their cursors and names are drawn. Neither side knows the other; the state shape is `PresenceState`.
 */
export class PresenceSync {
  readonly #awareness: Awareness;
  readonly #api: () => ExcalidrawImperativeAPI | null;
  #selection = '';
  #destroyed = false;

  readonly #publishPointer = throttle((update: PointerUpdate) => {
    if (this.#destroyed) return;
    this.#awareness.setLocalStateField('pointer', update.pointer);
    this.#awareness.setLocalStateField('button', update.button);
  }, POINTER_INTERVAL_MS);

  constructor(
    awareness: Awareness,
    identity: SessionIdentity,
    api: () => ExcalidrawImperativeAPI | null,
  ) {
    this.#awareness = awareness;
    this.#api = api;
    awareness.setLocalState({ user: identity } satisfies PresenceState);
    awareness.on('change', this.#onChange);
  }

  /** The pointer moved on the canvas (Excalidraw's `onPointerUpdate`). */
  pointerMoved(update: PointerUpdate): void {
    this.#publishPointer(update);
  }

  /** The selection changed; only a different set of ids is published. */
  selectionChanged(selectedElementIds: Readonly<Record<string, boolean>>): void {
    const ids = Object.keys(selectedElementIds).filter((id) => selectedElementIds[id]);
    const key = ids.sort().join(',');
    if (key === this.#selection) return;
    this.#selection = key;
    this.#awareness.setLocalStateField(
      'selectedElementIds',
      Object.fromEntries(ids.map((id) => [id, true])),
    );
  }

  /** The awareness changed: only a change of another client is worth redrawing the canvas for. */
  #onChange = ({
    added,
    updated,
    removed,
  }: {
    added: number[];
    updated: number[];
    removed: number[];
  }): void => {
    const own = this.#awareness.clientID;
    if ([...added, ...updated, ...removed].some((clientId) => clientId !== own)) {
      this.refresh();
    }
  };

  /** Puts the other clients on the canvas; also called once the canvas is ready, for those already there. */
  refresh = (): void => {
    const api = this.#api();
    if (!api || this.#destroyed) return;
    api.updateScene({
      collaborators: toCollaborators(this.#awareness.getStates(), this.#awareness.clientID),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  };

  destroy(): void {
    this.#destroyed = true;
    this.#publishPointer.cancel();
    this.#awareness.off('change', this.#onChange);
  }
}
