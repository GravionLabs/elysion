import {
  CaptureUpdateAction,
  exportToBlob,
  exportToSvg,
  loadFromBlob,
  serializeAsJSON,
} from '@excalidraw/excalidraw';
import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from '@excalidraw/excalidraw/element/types';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { svgToPdf } from './pdf';

export type ExportFormat = 'png' | 'svg' | 'excalidraw' | 'pdf';

export interface ExportOptions {
  /** Export only what is selected (with the text bound to selected shapes). */
  selectionOnly?: boolean;
}

/** The elements to export: everything, or the selected ones plus the text inside selected shapes. */
export function elementsToExport(
  elements: readonly NonDeletedExcalidrawElement[],
  selectedIds: Readonly<Record<string, boolean>> | null,
): readonly NonDeletedExcalidrawElement[] {
  if (!selectedIds) return elements;
  return elements.filter(
    (element) =>
      selectedIds[element.id] === true ||
      (element.type === 'text' &&
        !!element.containerId &&
        selectedIds[element.containerId] === true),
  );
}

const nonce = () => Math.floor(Math.random() * 2 ** 31);

/**
 * The scene after an import replaces the board: elements that are in the file take its version (made
 * newer than the current one, so the change wins), everything else that is live is tombstoned with
 * `isDeleted`, and new elements are added. Not simply the file's elements: the Yjs binding never
 * removes entries from the shared map, so an element that just vanished from the scene would be merged
 * back from it and stay on every other peer's board.
 */
export function replaceScene(
  existing: readonly ExcalidrawElement[],
  imported: readonly ExcalidrawElement[],
): ExcalidrawElement[] {
  const incoming = new Map(imported.map((element) => [element.id, element]));
  const next: ExcalidrawElement[] = [];
  for (const element of existing) {
    const replacement = incoming.get(element.id);
    if (replacement) {
      incoming.delete(element.id);
      next.push({
        ...replacement,
        version: Math.max(replacement.version, element.version + 1),
        versionNonce: nonce(),
        updated: Date.now(),
      } as ExcalidrawElement);
    } else if (element.isDeleted) {
      next.push(element);
    } else {
      next.push({
        ...element,
        isDeleted: true,
        version: element.version + 1,
        versionNonce: nonce(),
        updated: Date.now(),
      } as ExcalidrawElement);
    }
  }
  return [...next, ...incoming.values()];
}

/** The board as a file in the chosen format, or `null` when there is nothing to export. */
export async function exportBoard(
  api: ExcalidrawImperativeAPI,
  format: ExportFormat,
  { selectionOnly = false }: ExportOptions = {},
): Promise<Blob | null> {
  const appState = api.getAppState();
  const elements = elementsToExport(
    api.getSceneElements(),
    selectionOnly ? appState.selectedElementIds : null,
  );
  if (elements.length === 0) return null;

  const files = api.getFiles();
  // What you see, on its background: the current theme and view background are kept.
  const exportState = { ...appState, exportBackground: true };

  switch (format) {
    case 'png':
      return exportToBlob({ elements, appState: exportState, files, mimeType: 'image/png' });
    case 'svg': {
      const svg = await exportToSvg({ elements, appState: exportState, files });
      return new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
    }
    case 'pdf':
      return svgToPdf(await exportToSvg({ elements, appState: exportState, files }));
    case 'excalidraw':
      return new Blob([serializeAsJSON(elements, appState, files, 'local')], {
        type: 'application/json',
      });
  }
}

/** Replaces the board with the contents of an .excalidraw file; returns how many elements it has. */
export async function importFile(api: ExcalidrawImperativeAPI, file: Blob): Promise<number> {
  let data;
  try {
    data = await loadFromBlob(file, null, null);
  } catch {
    throw new Error('This is not an Excalidraw file.');
  }

  const imported = data.elements.filter((element) => !element.isDeleted);
  api.addFiles(Object.values(data.files ?? {}));
  api.updateScene({
    elements: replaceScene(api.getSceneElementsIncludingDeleted(), imported),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  if (imported.length > 0) {
    api.scrollToContent(imported, { fitToViewport: true, animate: false });
  }
  return imported.length;
}
