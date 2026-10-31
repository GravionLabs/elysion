import * as Y from 'yjs';
import type { NonDeletedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { thumbnailOf } from '../board-io';

/** The key of the document's map of elements (`yjs/excalidraw-binding.ts`). */
const ELEMENTS_MAP_KEY = 'elements';

/**
 * The live elements of a stored board state (a `Y.encodeStateAsUpdate`), in drawing order. Deleted elements stay in the
 * document as tombstones and are not part of the picture.
 */
export function liveElementsOf(state: Uint8Array): NonDeletedExcalidrawElement[] {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    const elements = [
      ...doc.getMap<{ isDeleted?: boolean; index?: string | null }>(ELEMENTS_MAP_KEY).values(),
    ];
    return elements
      .filter((element) => !element.isDeleted)
      .sort((a, b) => (a.index ?? '').localeCompare(b.index ?? '', 'en'))
      .map((element) => element as unknown as NonDeletedExcalidrawElement);
  } finally {
    doc.destroy();
  }
}

/**
 * The preview picture of a stored version, drawn like a board's card thumbnail (#728); `null` when the version is empty. Images
 * are not part of it (their bytes are not in the state).
 */
export function renderSnapshotPreview(state: Uint8Array): Promise<Blob | null> {
  return thumbnailOf(liveElementsOf(state), {}, {});
}
