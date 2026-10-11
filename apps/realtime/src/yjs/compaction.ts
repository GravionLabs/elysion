import * as Y from 'yjs';
import { GENERATION_KEY, META_MAP_KEY, newGeneration } from './generation.js';

/**
 * The encoded state of a document rebuilt from what it holds now (ADR 0026, option B): every root map is copied entry by
 * entry into a fresh `Y.Doc`, which has a new client id and new clocks and none of the history of the writes. The
 * rebuilt document has a new generation, so a client that holds the old one is not merged into it.
 *
 * `null` when the document holds something this cannot copy faithfully (a root type that is not a map, a shared type as a
 * value): compaction is housekeeping, so it then does nothing instead of risking the content.
 */
export function rebuildDocument(source: Y.Doc): Uint8Array | null {
  const target = new Y.Doc();
  try {
    target.transact(() => {
      for (const name of source.share.keys()) {
        const from = source.getMap<unknown>(name);
        const into = target.getMap<unknown>(name);
        for (const [key, value] of from.entries()) {
          if (value instanceof Y.AbstractType) {
            throw new Error(`The value of ${name}.${key} is a shared type`);
          }
          into.set(key, value);
        }
      }
      target.getMap<unknown>(META_MAP_KEY).set(GENERATION_KEY, newGeneration());
    });
    return Y.encodeStateAsUpdate(target);
  } catch {
    return null;
  } finally {
    target.destroy();
  }
}
