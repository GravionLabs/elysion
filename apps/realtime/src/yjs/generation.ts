import { randomUUID } from 'node:crypto';
import type * as Y from 'yjs';

/** The map of board settings; `generation` in it is the document's (ADR 0026), the rest belongs to the canvas. */
export const META_MAP_KEY = 'meta';
export const GENERATION_KEY = 'generation';

/** The document's generation: a random id that changes whenever the document is rebuilt. `undefined` for a document that has none yet. */
export function readGeneration(doc: Y.Doc): string | undefined {
  const value = doc.getMap<unknown>(META_MAP_KEY).get(GENERATION_KEY);
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function newGeneration(): string {
  return randomUUID();
}
