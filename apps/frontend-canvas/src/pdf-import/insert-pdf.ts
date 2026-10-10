import { CaptureUpdateAction, convertToExcalidrawElements } from '@excalidraw/excalidraw';
import { newElementWith } from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { BinaryFileData, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { MAX_IMAGE_BYTES, fileIdOf, readAsDataUrl } from '../image-insert';
import { type OpenedPdf } from './pdf-source';
import { gridCells } from './pdf-pages';

export interface InsertPdfOptions {
  api: ExcalidrawImperativeAPI;
  pdf: OpenedPdf;
  /** The pages to bring onto the board, 1-based, in order. */
  pages: readonly number[];
  /** The width in pixels each page is rendered at. */
  width: number;
  /** The name of the frame of a page (`Page 3`). */
  frameName: (page: number) => string;
  signal: AbortSignal;
  /** Called after each page, with how many are done. */
  onProgress: (done: number, total: number) => void;
  /** A page that could not be brought onto the board (too large even when smaller), with its number. */
  onSkipped: (page: number) => void;
}

/** Renders a page as a PNG that fits the limit of a picture on the board, rendering it smaller when it does not. */
async function renderWithinLimit(pdf: OpenedPdf, page: number, width: number, signal: AbortSignal) {
  for (const factor of [1, 0.75, 0.5, 0.35]) {
    const blob = await pdf.render(page, Math.max(200, Math.round(width * factor)), signal);
    if (blob === null) return null; // canceled
    if (blob.size <= MAX_IMAGE_BYTES) return blob;
  }
  return undefined; // too large at every size
}

/**
 * Brings the chosen pages onto the board: each is rendered in the browser, becomes a picture (stored through the file store by
 * the binding, like any image) inside a frame named after its page, and the frames are laid out in a grid around the middle of
 * the view, all in one undo step. Resolves with the number of pages inserted; `0` when it was canceled (nothing is inserted).
 */
export async function insertPdfPages(options: InsertPdfOptions): Promise<number> {
  const { api, pdf, pages, width, signal, onProgress, onSkipped } = options;
  const rendered: { page: number; file: File; dataURL: string; id: string; aspect: number }[] = [];
  for (const [index, page] of pages.entries()) {
    if (signal.aborted) return 0;
    const blob = await renderWithinLimit(pdf, page, width, signal);
    if (blob === null) return 0;
    if (blob === undefined) {
      onSkipped(page);
    } else {
      const file = new File([blob], `page-${page}.png`, { type: 'image/png' });
      rendered.push({
        page,
        file,
        dataURL: await readAsDataUrl(file),
        id: await fileIdOf(file),
        aspect: await pdf.aspectOf(page),
      });
    }
    onProgress(index + 1, pages.length);
  }
  if (signal.aborted || rendered.length === 0) return 0;

  const state = api.getAppState();
  const center = {
    x: (state.scrollX * -1 + state.width / 2) / state.zoom.value,
    y: (state.scrollY * -1 + state.height / 2) / state.zoom.value,
  };
  const cells = gridCells(
    rendered.map((entry) => entry.aspect),
    center,
  );
  api.addFiles(
    rendered.map((entry) => ({
      id: entry.id as BinaryFileData['id'],
      dataURL: entry.dataURL as BinaryFileData['dataURL'],
      mimeType: 'image/png' as const,
      created: Date.now(),
    })),
  );
  const skeletons = rendered.flatMap((entry, index) => {
    const cell = cells[index]!;
    return [
      {
        type: 'image' as const,
        x: cell.x,
        y: cell.y,
        width: cell.width,
        height: cell.height,
        fileId: entry.id as BinaryFileData['id'],
        status: 'saved' as const,
        scale: [1, 1] as [number, number],
      },
      {
        type: 'frame' as const,
        x: cell.x,
        y: cell.y,
        width: cell.width,
        height: cell.height,
        name: options.frameName(entry.page),
        children: [],
      },
    ];
  });
  const converted = convertToExcalidrawElements(skeletons);
  // Pairs of (image, frame): the images belong to their frames, and come before them in the order (a frame clips what is below it).
  const created: ExcalidrawElement[] = [];
  for (let i = 0; i < converted.length; i += 2) {
    const frame = converted[i + 1]!;
    created.push(newElementWith(converted[i]!, { frameId: frame.id }), frame);
  }
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...created],
    appState: {
      selectedElementIds: Object.fromEntries(
        created.filter((element) => element.type === 'frame').map((element) => [element.id, true]),
      ),
    },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return rendered.length;
}
