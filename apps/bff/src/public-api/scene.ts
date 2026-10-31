import { BadGatewayException } from '@nestjs/common';
import * as Y from 'yjs';

/** The keys of the board document's maps (`apps/frontend-canvas/src/yjs/excalidraw-binding.ts`). */
const ELEMENTS_MAP_KEY = 'elements';
const FILES_MAP_KEY = 'files';

/** A file of the scene: no bytes, a link to them instead (the API returns images as links, not inline). */
export interface SceneFile {
  id: string;
  mimeType: string;
  created: number;
  url: string;
}

/**
 * A board's elements as an Excalidraw scene (the `.excalidraw` file format, `version: 2`), with `files` holding links instead of
 * Excalidraw's `dataURL`s.
 */
export interface Scene {
  type: 'excalidraw';
  version: 2;
  source: 'elysion';
  elements: Array<Record<string, unknown>>;
  appState: Record<string, never>;
  files: Record<string, SceneFile>;
}

/** An empty board: never saved, or every element deleted. */
export function emptyScene(): Scene {
  return {
    type: 'excalidraw',
    version: 2,
    source: 'elysion',
    elements: [],
    appState: {},
    files: {},
  };
}

/**
 * Decodes a stored board state (a `Y.encodeStateAsUpdate` of the board's document, ADR 0011) into its scene: the live elements in
 * drawing order (deleted ones stay in the document as tombstones and are left out) and the files the live elements show, each as a
 * link made by `fileUrl`. Read-only: nothing is written back.
 */
export function sceneOf(state: Uint8Array, fileUrl: (fileId: string) => string): Scene {
  const doc = new Y.Doc();
  try {
    try {
      Y.applyUpdate(doc, state);
    } catch {
      throw new BadGatewayException('The stored board could not be read.');
    }
    const elements = [...doc.getMap<unknown>(ELEMENTS_MAP_KEY).values()]
      .filter((element): element is Record<string, unknown> => isRecord(element))
      .filter((element) => element.isDeleted !== true)
      .sort(drawingOrder);
    const references = doc.getMap<unknown>(FILES_MAP_KEY);
    const files: Record<string, SceneFile> = {};
    for (const element of elements) {
      const fileId = element.fileId;
      if (typeof fileId !== 'string' || fileId in files) continue;
      const reference = references.get(fileId);
      if (!isRecord(reference)) continue; // not uploaded (yet): Excalidraw shows a placeholder
      files[fileId] = {
        id: fileId,
        mimeType:
          typeof reference.mimeType === 'string' ? reference.mimeType : 'application/octet-stream',
        created: typeof reference.created === 'number' ? reference.created : 0,
        url: fileUrl(fileId),
      };
    }
    return { ...emptyScene(), elements, files };
  } finally {
    doc.destroy();
  }
}

/** Excalidraw's order: by the fractional `index` (compared as plain text, as Excalidraw does), then by id for a tie. */
function drawingOrder(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const left = typeof a.index === 'string' ? a.index : '';
  const right = typeof b.index === 'string' ? b.index : '';
  if (left !== right) return left < right ? -1 : 1;
  return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
