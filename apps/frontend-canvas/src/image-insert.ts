import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  viewportCoordsToSceneCoords,
} from '@excalidraw/excalidraw';
import type { BinaryFileData, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';

/**
 * Images dropped on the canvas or pasted into it (#724). Excalidraw takes one dropped image at its natural size; this
 * takes several (laid out in a row at the drop point or the middle of the view), at most half the view in height and keeping
 * their ratio, refuses what the board cannot keep with a message, and turns an SVG into a PNG (an SVG is a document that can
 * carry script: the object store refuses it, and so does the canvas, as a picture of it is all a board needs).
 */

/** The raster types the object store keeps (apps/business-backend, `Files`). */
export const RASTER_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export const SVG_TYPE = 'image/svg+xml';

/** The largest image file taken, as in Excalidraw itself; the object store takes more (10 MiB by default). */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** The longest side an SVG is drawn at when it becomes a PNG. */
export const MAX_SVG_SIDE = 1440;

/** The space between images laid out in a row, in scene units. */
export const ROW_GAP = 20;

export type ImageProblem = 'type' | 'size';

export interface Accepted {
  file: File;
  problem?: undefined;
}
export interface Refused {
  file: File;
  problem: ImageProblem;
}

/** Sorts files into those that can become images and those that cannot (and why). Only image files are looked at. */
export function sortFiles(files: readonly File[]): { accepted: File[]; refused: Refused[] } {
  const accepted: File[] = [];
  const refused: Refused[] = [];
  for (const file of files) {
    if (!isImageFile(file)) continue;
    if (!(RASTER_TYPES as readonly string[]).includes(file.type) && file.type !== SVG_TYPE) {
      refused.push({ file, problem: 'type' });
    } else if (file.size > MAX_IMAGE_BYTES) {
      refused.push({ file, problem: 'size' });
    } else {
      accepted.push(file);
    }
  }
  return { accepted, refused };
}

/** A file the browser says is an image of some kind; everything else (a text, a PDF) is none of this code's business. */
export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export interface Size {
  width: number;
  height: number;
}

export interface Box {
  /** The view's size in pixels and its zoom (scene units are pixels divided by the zoom). */
  viewWidth: number;
  viewHeight: number;
  zoom: number;
}

/**
 * The size an image gets on the board: its natural size, but at most half the height and the width of the view (in scene
 * units, so a zoomed-out view gives a larger image), the ratio kept, never enlarged.
 */
export function fit(natural: Size, view: Box): Size {
  const maxHeight = Math.floor(view.viewHeight * 0.5) / view.zoom;
  const maxWidth = Math.floor(view.viewWidth * 0.5) / view.zoom;
  const scale = Math.min(1, maxHeight / natural.height, maxWidth / natural.width);
  return { width: natural.width * scale, height: natural.height * scale };
}

export interface Placed extends Size {
  x: number;
  y: number;
}

/**
 * Lays images out in a row centered on `center`: left to right with {@link ROW_GAP} between them, their middles on one
 * line. A row wider than the view is scaled down to fit it, so that all of them are seen.
 */
export function layoutRow(
  sizes: readonly Size[],
  center: { x: number; y: number },
  view: Box,
): Placed[] {
  const total =
    sizes.reduce((sum, size) => sum + size.width, 0) + ROW_GAP * Math.max(0, sizes.length - 1);
  const room = (view.viewWidth * 0.9) / view.zoom;
  const scale = total > room ? room / total : 1;
  const widthOfRow = total * scale;
  let x = center.x - widthOfRow / 2;
  return sizes.map((size) => {
    const width = size.width * scale;
    const height = size.height * scale;
    const placed = { x, y: center.y - height / 2, width, height };
    x += width + ROW_GAP * scale;
    return placed;
  });
}

/** What Excalidraw calls a file: a hash of its content, so that the same image is stored once per board. */
export async function fileIdOf(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsDataURL(blob);
  });
}

/** An image's natural size, read by the browser. */
export function naturalSize(dataUrl: string): Promise<Size> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({ width: image.naturalWidth || 300, height: image.naturalHeight || 150 });
    image.onerror = () => reject(new Error('The image could not be read.'));
    image.src = dataUrl;
  });
}

/** An SVG drawn into a PNG, at its own size but no side longer than {@link MAX_SVG_SIDE}. */
export async function rasterizeSvg(file: File): Promise<File> {
  const dataUrl = await readAsDataUrl(file);
  const natural = await naturalSize(dataUrl);
  const scale = Math.min(1, MAX_SVG_SIDE / Math.max(natural.width, natural.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(natural.width * scale));
  canvas.height = Math.max(1, Math.round(natural.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('A canvas could not be made for the image.');
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The image could not be read.'));
    image.src = dataUrl;
  });
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The image could not be converted.');
  return new File([blob], file.name.replace(/\.svg$/i, '') + '.png', { type: 'image/png' });
}

/** What {@link insertImages} needs from the host canvas. */
export interface ImageHost {
  api: ExcalidrawImperativeAPI;
  /** Where to say what could not be added (the `notice` event). */
  notify: (message: string) => void;
  messages: {
    imageTypeNotSupported: (name: string) => string;
    imageTooLarge: (name: string) => string;
    imageUnreadable: (name: string) => string;
  };
}

/**
 * Puts image files on the board: those the board can keep as images in a row at `at` (a point in the scene; the middle of
 * the view when not given), each at most half the view in height, selected so that they can be moved together, in one undo
 * step. What cannot be added is said, file by file. The files go to the object store through the binding, like any image.
 */
export async function insertImages(
  host: ImageHost,
  files: readonly File[],
  at?: { x: number; y: number },
): Promise<number> {
  const { api, notify, messages } = host;
  const { accepted, refused } = sortFiles(files);
  for (const { file, problem } of refused) {
    notify(
      problem === 'type'
        ? messages.imageTypeNotSupported(file.name)
        : messages.imageTooLarge(file.name),
    );
  }
  const prepared: { file: File; dataURL: string; size: Size; id: string }[] = [];
  for (const original of accepted) {
    try {
      const file = original.type === SVG_TYPE ? await rasterizeSvg(original) : original;
      const dataURL = await readAsDataUrl(file);
      prepared.push({ file, dataURL, size: await naturalSize(dataURL), id: await fileIdOf(file) });
    } catch {
      notify(messages.imageUnreadable(original.name));
    }
  }
  if (prepared.length === 0) return 0;

  const state = api.getAppState();
  const view: Box = { viewWidth: state.width, viewHeight: state.height, zoom: state.zoom.value };
  const center =
    at ??
    viewportCoordsToSceneCoords(
      { clientX: state.offsetLeft + state.width / 2, clientY: state.offsetTop + state.height / 2 },
      state,
    );
  const placed = layoutRow(
    prepared.map((image) => fit(image.size, view)),
    center,
    view,
  );
  api.addFiles(
    prepared.map((image) => ({
      id: image.id as BinaryFileData['id'],
      dataURL: image.dataURL as BinaryFileData['dataURL'],
      mimeType: image.file.type as BinaryFileData['mimeType'],
      created: Date.now(),
    })),
  );
  const created = convertToExcalidrawElements(
    placed.map((box, index) => ({
      type: 'image' as const,
      ...box,
      fileId: prepared[index]!.id as BinaryFileData['id'],
      status: 'saved' as const,
      scale: [1, 1] as [number, number],
    })),
  );
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...created],
    appState: {
      selectedElementIds: Object.fromEntries(created.map((element) => [element.id, true])),
    },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return created.length;
}
