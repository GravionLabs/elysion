import { BadGatewayException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { emptyScene, sceneOf } from './scene.js';

/** A stored board state as the canvas writes it: elements and file references in two maps. */
function stateOf(
  elements: Array<Record<string, unknown>>,
  files: Record<string, unknown> = {},
): Uint8Array {
  const doc = new Y.Doc();
  const map = doc.getMap<unknown>('elements');
  for (const element of elements) map.set(String(element.id), element);
  const references = doc.getMap<unknown>('files');
  for (const [id, reference] of Object.entries(files)) references.set(id, reference);
  return Y.encodeStateAsUpdate(doc);
}

const link = (fileId: string) => `/public/v1/boards/b1/files/${fileId}`;

describe('sceneOf', () => {
  it('answers the live elements in drawing order as an Excalidraw scene', () => {
    const state = stateOf([
      { id: 'top', type: 'rectangle', index: 'a2', x: 10 },
      { id: 'gone', type: 'ellipse', index: 'a1', isDeleted: true },
      { id: 'bottom', type: 'text', index: 'a0', text: 'Hello' },
    ]);

    const scene = sceneOf(state, link);

    expect(scene).toEqual({
      type: 'excalidraw',
      version: 2,
      source: 'elysion',
      elements: [
        { id: 'bottom', type: 'text', index: 'a0', text: 'Hello' },
        { id: 'top', type: 'rectangle', index: 'a2', x: 10 },
      ],
      appState: {},
      files: {},
    });
  });

  it('orders indexes as plain text, as Excalidraw does (upper case before lower case)', () => {
    const state = stateOf([
      { id: 'lower', index: 'a0' },
      { id: 'upper', index: 'Zz' },
    ]);

    expect(sceneOf(state, link).elements.map((element) => element.id)).toEqual(['upper', 'lower']);
  });

  it('gives the images of live elements as links to their files, never their bytes', () => {
    const state = stateOf(
      [
        { id: 'img', type: 'image', index: 'a0', fileId: 'f1' },
        { id: 'deleted-img', type: 'image', index: 'a1', fileId: 'f2', isDeleted: true },
        { id: 'pending', type: 'image', index: 'a2', fileId: 'f3' },
      ],
      {
        f1: { mimeType: 'image/png', created: 1_761_900_000_000 },
        f2: { mimeType: 'image/jpeg', created: 1 },
      },
    );

    const scene = sceneOf(state, link);

    expect(scene.files).toEqual({
      f1: {
        id: 'f1',
        mimeType: 'image/png',
        created: 1_761_900_000_000,
        url: '/public/v1/boards/b1/files/f1',
      },
    });
    expect(JSON.stringify(scene)).not.toContain('dataURL');
  });

  it('answers an empty scene for an empty document', () => {
    expect(sceneOf(stateOf([]), link)).toEqual(emptyScene());
  });

  it('answers 502 for bytes that are no board state', () => {
    expect(() => sceneOf(new Uint8Array([255, 255, 255, 255]), link)).toThrow(BadGatewayException);
  });
});
