import { convertToExcalidrawElements, restoreAppState } from '@excalidraw/excalidraw';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import * as Y from 'yjs';
import { describe, expect, it, vi } from 'vitest';
import { ExcalidrawYjsBinding } from './excalidraw-binding.js';

function rectangle() {
  const [element] = convertToExcalidrawElements([{ type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }]);
  return element;
}

function createMockApi(initialElements: readonly OrderedExcalidrawElement[]) {
  let elements = initialElements;
  const updateScene = vi.fn((sceneData: { elements?: readonly OrderedExcalidrawElement[] }) => {
    if (sceneData.elements) {
      elements = sceneData.elements;
    }
  });
  const api = {
    getSceneElementsIncludingDeleted: () => elements,
    getAppState: () => restoreAppState(null, null),
    updateScene,
  } as unknown as ExcalidrawImperativeAPI;
  return { api, updateScene };
}

describe('ExcalidrawYjsBinding', () => {
  it('writes local changes into the shared doc', () => {
    const doc = new Y.Doc();
    const binding = new ExcalidrawYjsBinding(doc);
    const rect = rectangle();

    binding.onLocalChange([rect]);

    expect(doc.getMap('elements').get(rect.id)).toEqual(rect);
  });

  it('does not re-write an element whose version has not changed', () => {
    const doc = new Y.Doc();
    const binding = new ExcalidrawYjsBinding(doc);
    const rect = rectangle();

    binding.onLocalChange([rect]);
    const setSpy = vi.spyOn(doc.getMap('elements'), 'set');

    binding.onLocalChange([rect]);

    expect(setSpy).not.toHaveBeenCalled();
  });

  it('reconciles an existing remote element into the scene on attach', () => {
    const doc = new Y.Doc();
    const rect = rectangle();
    doc.getMap('elements').set(rect.id, rect);
    const binding = new ExcalidrawYjsBinding(doc);
    const { api, updateScene } = createMockApi([]);

    binding.attach(api);

    expect(updateScene).toHaveBeenCalledOnce();
    const [sceneData] = updateScene.mock.calls[0] as [{ elements: OrderedExcalidrawElement[] }];
    expect(sceneData.elements.map((element) => element.id)).toContain(rect.id);
  });

  it('reconciles later remote map changes into the scene', () => {
    const doc = new Y.Doc();
    const binding = new ExcalidrawYjsBinding(doc);
    const { api, updateScene } = createMockApi([]);
    binding.attach(api);
    updateScene.mockClear();

    const rect = rectangle();
    doc.getMap('elements').set(rect.id, rect);

    expect(updateScene).toHaveBeenCalledOnce();
    const [sceneData] = updateScene.mock.calls[0] as [{ elements: OrderedExcalidrawElement[] }];
    expect(sceneData.elements.map((element) => element.id)).toContain(rect.id);
  });
});
