import {
  CaptureUpdateAction,
  exportToBlob,
  exportToSvg,
  getCommonBounds,
  loadFromBlob,
  serializeAsJSON,
} from '@excalidraw/excalidraw';
import type {
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
  NonDeletedExcalidrawElement,
} from '@excalidraw/excalidraw/element/types';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { VIEW_BACKGROUND_COLOR } from './element-style';
import { framesInOrder, type ExportOptions } from './export-options';
import { svgsToPdf } from './pdf';

export type ExportFormat = 'png' | 'svg' | 'excalidraw' | 'pdf';
export type { ExportOptions } from './export-options';

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

/** The frames to make pages of: the frames of the board, or only those that are selected when the selection holds any. */
function framesToExport(
  elements: readonly NonDeletedExcalidrawElement[],
  selectedIds: Readonly<Record<string, boolean>> | null,
): ExcalidrawFrameLikeElement[] {
  const frames = elements.filter(
    (element): element is ExcalidrawFrameLikeElement =>
      element.type === 'frame' || element.type === 'magicframe',
  );
  const chosen = selectedIds ? frames.filter((frame) => selectedIds[frame.id] === true) : frames;
  return framesInOrder(chosen);
}

/** The board as a file in the chosen format, or `null` when there is nothing to export. */
export async function exportBoard(
  api: ExcalidrawImperativeAPI,
  format: ExportFormat,
  options: ExportOptions = {},
): Promise<Blob | null> {
  const { selectionOnly = false, background = true, theme = 'current', scale = 1 } = options;
  const appState = api.getAppState();
  const scene = api.getSceneElements();
  const selected = selectionOnly ? appState.selectedElementIds : null;
  const elements = elementsToExport(scene, selected);
  if (elements.length === 0) return null;

  const files = api.getFiles();
  // What you see, on its background: the current theme and view background are kept.
  const exportState = {
    ...appState,
    // The canvas itself is transparent (the board's color and grid are CSS), so the export brings the board's color.
    viewBackgroundColor: VIEW_BACKGROUND_COLOR,
    exportBackground: background,
    exportScale: scale,
    ...(theme === 'current' ? {} : { exportWithDarkMode: theme === 'dark' }),
  };

  switch (format) {
    case 'png':
      return exportToBlob({ elements, appState: exportState, files, mimeType: 'image/png' });
    case 'svg': {
      const svg = await exportToSvg({ elements, appState: exportState, files });
      return new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
    }
    case 'pdf': {
      const layout = { format: options.pageFormat, orientation: options.orientation };
      // A board with frames is a document: one page per frame, in the order of their names or their places, each with its
      // name as a title. A selection that holds frames makes pages of those; anything else is one page, as before.
      const frames = options.pdfPages === 'whole' ? [] : framesToExport(scene, selected);
      if (frames.length === 0) {
        return svgsToPdf(
          [{ svg: await exportToSvg({ elements, appState: exportState, files }) }],
          layout,
        );
      }
      const pages = [];
      for (const [index, frame] of frames.entries()) {
        pages.push({
          title: frame.name?.trim() || `${index + 1}`,
          svg: await exportToSvg({
            elements: scene,
            appState: exportState,
            files,
            exportingFrame: frame,
          }),
        });
      }
      return svgsToPdf(pages, layout);
    }
    case 'excalidraw':
      return new Blob(
        [
          serializeAsJSON(
            elements,
            { ...appState, viewBackgroundColor: VIEW_BACKGROUND_COLOR },
            files,
            'local',
          ),
        ],
        {
          type: 'application/json',
        },
      );
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

const freshId = () => crypto.randomUUID();

/**
 * Copies of `elements` that can be added to a board next to what is already there: every element gets a new id,
 * and everything that points at an id (a text's container, a shape's bound texts and arrows, an arrow's ends,
 * groups, frames) points at the new one, so the copies are consistent among themselves and share nothing with
 * the original or with a second insertion of the same scene. They are moved so that their bounding box is
 * centered on `center`.
 */
export function cloneForInsertion(
  elements: readonly ExcalidrawElement[],
  center: { x: number; y: number },
): ExcalidrawElement[] {
  const ids = new Map(elements.map((element) => [element.id, freshId()]));
  const groups = new Map<string, string>();
  const mapId = (id: string | null | undefined) => (id ? (ids.get(id) ?? null) : null);
  const mapGroup = (id: string) => groups.get(id) ?? groups.set(id, freshId()).get(id)!;

  const [minX, minY, maxX, maxY] = getCommonBounds(elements);
  const dx = center.x - (minX + maxX) / 2;
  const dy = center.y - (minY + maxY) / 2;

  return elements.map((element) => {
    const copy: Record<string, unknown> = {
      ...element,
      id: ids.get(element.id),
      x: element.x + dx,
      y: element.y + dy,
      seed: nonce(),
      version: 1,
      versionNonce: nonce(),
      updated: Date.now(),
      index: null, // placed on top by the scene, not at the index of the file it came from
      groupIds: element.groupIds.map(mapGroup),
      frameId: mapId(element.frameId),
      boundElements: element.boundElements
        ? element.boundElements.flatMap((bound) => {
            const id = mapId(bound.id);
            return id ? [{ ...bound, id }] : [];
          })
        : null,
    };
    if ('containerId' in element) copy['containerId'] = mapId(element.containerId);
    for (const end of ['startBinding', 'endBinding'] as const) {
      const binding = (element as unknown as Record<string, { elementId: string } | null>)[end];
      if (binding) {
        const elementId = mapId(binding.elementId);
        copy[end] = elementId ? { ...binding, elementId } : null;
      }
    }
    return copy as unknown as ExcalidrawElement;
  });
}

/**
 * Adds the contents of an .excalidraw file to the board, around the middle of what the user sees, and
 * selects them; what is on the board stays. One undo step. Resolves with the number of elements added.
 */
export async function insertFile(api: ExcalidrawImperativeAPI, file: Blob): Promise<number> {
  let data;
  try {
    data = await loadFromBlob(file, null, null);
  } catch {
    throw new Error('This is not an Excalidraw file.');
  }
  const scene = data.elements.filter((element) => !element.isDeleted);
  if (scene.length === 0) return 0;

  const { scrollX, scrollY, zoom, width, height } = api.getAppState();
  const center = {
    x: width / 2 / zoom.value - scrollX,
    y: height / 2 / zoom.value - scrollY,
  };
  const added = cloneForInsertion(scene, center);

  api.addFiles(Object.values(data.files ?? {}));
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...added],
    appState: {
      // The shapes, not the texts inside them: those are selected through their container.
      selectedElementIds: Object.fromEntries(
        added
          .filter(
            (element) =>
              !(element.type === 'text' && (element as { containerId?: string }).containerId),
          )
          .map((element) => [element.id, true]),
      ),
    },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return added.length;
}

/**
 * The scene after "clear canvas": every live element is marked deleted with a newer version, none is dropped. The
 * Yjs binding never removes entries from the shared map, so an element that just vanished from the scene would be
 * merged back from it and stay on every other peer's board (see `replaceScene`).
 */
export function clearScene(existing: readonly ExcalidrawElement[]): ExcalidrawElement[] {
  return existing.map((element) =>
    element.isDeleted
      ? element
      : ({
          ...element,
          isDeleted: true,
          version: element.version + 1,
          versionNonce: nonce(),
          updated: Date.now(),
        } as ExcalidrawElement),
  );
}
