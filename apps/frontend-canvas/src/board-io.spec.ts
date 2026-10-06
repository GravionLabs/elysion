import { convertToExcalidrawElements, serializeAsJSON } from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cloneForInsertion,
  elementsToExport,
  exportBoard,
  importFile,
  insertFile,
  replaceScene,
} from './board-io';
import { createStickyNote, STICKY_COLORS } from './sticky-note';

// convertToExcalidrawElements ignores a given `id` and makes up its own, so ids are set afterwards.
function rect(id: string, x = 0, y = 0, size = 10): ExcalidrawElement {
  const [element] = convertToExcalidrawElements([
    { type: 'rectangle', x, y, width: size, height: size },
  ]);
  return { ...element, id } as unknown as ExcalidrawElement;
}

/** A shape with a text bound to it, like a sticky note. */
function labeled(id: string): ExcalidrawElement[] {
  const [shape, text] = convertToExcalidrawElements([
    { type: 'rectangle', x: 0, y: 0, width: 100, height: 60, label: { text: 'Note' } },
  ]);
  return [
    { ...shape, id, boundElements: [{ type: 'text', id: `${id}-text` }] },
    { ...text, id: `${id}-text`, containerId: id },
  ] as unknown as ExcalidrawElement[];
}

function fakeApi(scene: ExcalidrawElement[], selected: Record<string, boolean> = {}) {
  const updateScene = vi.fn();
  const addFiles = vi.fn();
  const scrollToContent = vi.fn();
  const api = {
    getAppState: () => ({
      selectedElementIds: selected,
      scrollX: -100,
      scrollY: -50,
      zoom: { value: 2 },
      width: 1000,
      height: 600,
      viewBackgroundColor: '#ffffff',
      theme: 'light',
    }),
    getSceneElements: () => scene.filter((e) => !e.isDeleted),
    getSceneElementsIncludingDeleted: () => scene,
    getFiles: () => ({}),
    updateScene,
    addFiles,
    scrollToContent,
  } as unknown as ExcalidrawImperativeAPI;
  return { api, updateScene, addFiles, scrollToContent };
}

describe('elementsToExport', () => {
  const all = [...labeled('card'), rect('other'), ...labeled('c2')] as never[];

  it('is everything without a selection filter', () => {
    expect(elementsToExport(all, null)).toHaveLength(all.length);
  });

  it('is the selected elements plus the text bound to a selected shape', () => {
    const ids = elementsToExport(all, { card: true }).map((e) => e.id);

    expect(ids).toEqual(['card', 'card-text']);
  });

  it('does not take along the text of a shape that is not selected', () => {
    const ids = elementsToExport(all, { other: true }).map((e) => e.id);

    expect(ids).toEqual(['other']);
  });
});

describe('replaceScene', () => {
  it('tombstones what is not in the file instead of dropping it', () => {
    const old = rect('old');

    const [gone] = replaceScene([old], []);

    expect(gone).toMatchObject({ id: 'old', isDeleted: true });
    expect(gone.version).toBe(old.version + 1);
    expect(gone.versionNonce).not.toBe(old.versionNonce);
  });

  it('adds the elements that are new', () => {
    const result = replaceScene([rect('old')], [rect('fresh')]);

    expect(result.map((e) => [e.id, e.isDeleted])).toEqual([
      ['old', true],
      ['fresh', false],
    ]);
  });

  it('lets the file win for an id that is in both, with a newer version than the current one', () => {
    const current = { ...rect('same'), version: 7, x: 1 } as ExcalidrawElement;
    const fromFile = { ...rect('same'), version: 2, x: 99 } as ExcalidrawElement;

    const [merged] = replaceScene([current], [fromFile]);

    expect(merged).toMatchObject({ id: 'same', x: 99, isDeleted: false });
    expect(merged.version).toBe(8);
  });

  it('keeps an existing tombstone as it is', () => {
    const dead = { ...rect('dead'), isDeleted: true, version: 3 } as ExcalidrawElement;

    expect(replaceScene([dead], [])).toEqual([dead]);
  });

  it('never repeats an id', () => {
    const result = replaceScene([rect('a'), rect('b')], [rect('b'), rect('c')]);

    const ids = result.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('exportBoard', () => {
  const scene = [rect('a'), rect('b')];

  it('answers null for an empty board', async () => {
    expect(await exportBoard(fakeApi([]).api, 'svg')).toBeNull();
  });

  it('writes an SVG', async () => {
    const blob = (await exportBoard(fakeApi(scene).api, 'svg'))!;

    expect(blob.type).toBe('image/svg+xml');
    expect(await blob.text()).toContain('<svg');
  });

  it('writes a PNG', async () => {
    const blob = (await exportBoard(fakeApi(scene).api, 'png'))!;

    expect(blob.type).toBe('image/png');
  });

  it('writes an .excalidraw file that can be read back', async () => {
    const blob = (await exportBoard(fakeApi(scene).api, 'excalidraw'))!;

    const json = JSON.parse(await blob.text());
    expect(json.type).toBe('excalidraw');
    expect(json.elements.map((e: ExcalidrawElement) => e.id)).toEqual(['a', 'b']);
  });

  it('exports only the selection when asked, and nothing when nothing is selected', async () => {
    const { api } = fakeApi(scene, { b: true });
    const only = JSON.parse(
      await (await exportBoard(api, 'excalidraw', { selectionOnly: true }))!.text(),
    );
    expect(only.elements.map((e: ExcalidrawElement) => e.id)).toEqual(['b']);

    expect(
      await exportBoard(fakeApi(scene, {}).api, 'excalidraw', { selectionOnly: true }),
    ).toBeNull();
  });

  describe('as a PDF', () => {
    // svg2pdf.js asks every SVG element for its box, which jsdom does not have.
    beforeEach(() => {
      (SVGElement.prototype as unknown as { getBBox: () => object }).getBBox = () => ({
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      });
    });

    const inspect = async (blob: Blob) => {
      const text = new TextDecoder('latin1').decode(await blob.arrayBuffer());
      const box = text.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
      return {
        text,
        pages: (text.match(/\/Type \/Page\b/g) ?? []).length,
        width: Number(box?.[1]),
        height: Number(box?.[2]),
      };
    };

    it('is a real PDF with one page', async () => {
      const blob = (await exportBoard(fakeApi(scene).api, 'pdf'))!;

      expect(blob.type).toBe('application/pdf');
      const pdf = await inspect(blob);
      expect(pdf.text.startsWith('%PDF-')).toBe(true);
      expect(pdf.pages).toBe(1);
      expect(pdf.width).toBeGreaterThan(0);
    });

    it('answers null for an empty board and for an empty selection', async () => {
      expect(await exportBoard(fakeApi([]).api, 'pdf')).toBeNull();
      expect(await exportBoard(fakeApi(scene, {}).api, 'pdf', { selectionOnly: true })).toBeNull();
    });

    it('makes the page as large as what is exported: the selection is a smaller page than the board', async () => {
      const far = [rect('near', 0, 0, 100), rect('far', 2000, 1000, 100)];

      const whole = await inspect((await exportBoard(fakeApi(far).api, 'pdf'))!);
      const selection = await inspect(
        (await exportBoard(fakeApi(far, { near: true }).api, 'pdf', { selectionOnly: true }))!,
      );

      expect(selection.width).toBeLessThan(whole.width);
      expect(selection.height).toBeLessThan(whole.height);
      expect(selection.pages).toBe(1);
    });

    it('keeps the text of a labeled shape as text in the built-in font', async () => {
      const blob = (await exportBoard(fakeApi(labeled('card')).api, 'pdf'))!;

      expect((await inspect(blob)).text).toContain('/BaseFont /Helvetica');
    });
  });

  it('leaves deleted elements out', async () => {
    const dead = { ...rect('dead'), isDeleted: true } as ExcalidrawElement;

    const json = JSON.parse(
      await (await exportBoard(fakeApi([rect('a'), dead]).api, 'excalidraw'))!.text(),
    );

    expect(json.elements.map((e: ExcalidrawElement) => e.id)).toEqual(['a']);
  });
});

describe('importFile', () => {
  const file = (els: ExcalidrawElement[]) =>
    new Blob([serializeAsJSON(els, {}, {}, 'local')], { type: 'application/json' });

  it('replaces the board and answers how many elements the file has', async () => {
    const { api, updateScene, scrollToContent } = fakeApi([rect('old')]);

    const count = await importFile(api, file([rect('x'), rect('y')]));

    expect(count).toBe(2);
    const scene = updateScene.mock.calls[0][0].elements as ExcalidrawElement[];
    expect(scene.find((e) => e.id === 'old')?.isDeleted).toBe(true);
    expect(scene.filter((e) => !e.isDeleted).map((e) => e.id)).toEqual(['x', 'y']);
    expect(scrollToContent).toHaveBeenCalledOnce();
  });

  it('does not touch the board when the file is not an Excalidraw file', async () => {
    const { api, updateScene } = fakeApi([rect('old')]);

    await expect(importFile(api, new Blob(['{"hello": "world"}']))).rejects.toThrow(
      'This is not an Excalidraw file.',
    );
    await expect(importFile(api, new Blob(['not json at all']))).rejects.toThrow(
      'This is not an Excalidraw file.',
    );
    expect(updateScene).not.toHaveBeenCalled();
  });

  it('clears the board for an empty file without scrolling anywhere', async () => {
    const { api, updateScene, scrollToContent } = fakeApi([rect('old')]);

    expect(await importFile(api, file([]))).toBe(0);

    expect(updateScene.mock.calls[0][0].elements[0].isDeleted).toBe(true);
    expect(scrollToContent).not.toHaveBeenCalled();
  });
});

describe('cloneForInsertion', () => {
  const center = { x: 500, y: 300 };

  it('gives every element a new id and keeps the text bound to its container', () => {
    const note = labeled('n');

    const [shape, text] = cloneForInsertion(note, center) as unknown as [
      { id: string; boundElements: { id: string }[] },
      { id: string; containerId: string },
    ];

    expect(shape.id).not.toBe('n');
    expect(text.id).not.toBe('n-text');
    expect(text.containerId).toBe(shape.id);
    expect(shape.boundElements).toEqual([{ type: 'text', id: text.id }]);
  });

  it('moves the elements so that their bounding box is centered on the given point', () => {
    const [a, b] = cloneForInsertion([rect('a', 0, 0, 100), rect('b', 200, 100, 100)], center);

    // The box spans 0..300 x 0..200: its middle is (150, 100).
    expect([a.x, a.y]).toEqual([350, 200]);
    expect([b.x, b.y]).toEqual([550, 300]);
  });

  it('points arrows and groups at the new ids, and leaves no reference to the old ones', () => {
    const [a, b] = [rect('a'), rect('b', 100)] as unknown as Record<string, unknown>[];
    a['groupIds'] = ['g'];
    b['groupIds'] = ['g'];
    const [base] = convertToExcalidrawElements([
      {
        type: 'arrow',
        x: 0,
        y: 0,
        points: [
          [0, 0],
          [50, 0],
        ],
      },
    ]);
    const arrow = {
      ...base,
      id: 'arrow',
      startBinding: { elementId: 'a', focus: 0, gap: 1 },
      endBinding: { elementId: 'gone', focus: 0, gap: 1 },
    } as unknown as ExcalidrawElement;

    const [ca, cb, carrow] = cloneForInsertion(
      [a, b, arrow] as unknown as ExcalidrawElement[],
      center,
    ) as unknown as Record<string, any>[]; // eslint-disable-line

    expect(carrow['startBinding'].elementId).toBe(ca['id']);
    expect(carrow['endBinding']).toBeNull(); // its target is not part of the scene
    expect(ca['groupIds']).toEqual(cb['groupIds']);
    expect(ca['groupIds'][0]).not.toBe('g');
  });

  it('makes different ids for every insertion of the same scene', () => {
    const scene = labeled('n');

    const first = cloneForInsertion(scene, center).map((e) => e.id);
    const second = cloneForInsertion(scene, center).map((e) => e.id);

    expect(new Set([...first, ...second]).size).toBe(4);
  });
});

describe('insertFile', () => {
  const file = (els: readonly ExcalidrawElement[]) =>
    new Blob([serializeAsJSON(els, {}, {}, 'local')], { type: 'application/json' });
  const center = { x: 1000 / 2 / 2 + 100, y: 600 / 2 / 2 + 50 }; // the view's middle in scene coordinates

  it('keeps what is on the board and adds the new elements with fresh ids around the view center', async () => {
    const existing = rect('old', 0, 0, 10);
    const { api, updateScene } = fakeApi([existing]);

    const count = await insertFile(api, file([rect('x', 0, 0, 40), rect('y', 60, 0, 40)]));

    expect(count).toBe(2);
    const call = updateScene.mock.calls[0][0];
    const scene = call.elements as ExcalidrawElement[];
    expect(scene[0]).toBe(existing);
    const added = scene.slice(1);
    expect(added.map((e) => e.id)).not.toContain('x');
    expect(added.map((e) => e.id)).not.toContain('y');
    // 100 wide, 40 high: centered on the view
    expect(added[0].x).toBe(center.x - 50);
    expect(added[0].y).toBe(center.y - 20);
    expect(Object.keys(call.appState.selectedElementIds).sort()).toEqual(
      added.map((e) => e.id).sort(),
    );
  });

  it('is one undo step: a single scene update that is recorded', async () => {
    const { api, updateScene } = fakeApi([]);

    await insertFile(api, file([rect('x')]));

    expect(updateScene).toHaveBeenCalledOnce();
    expect(updateScene.mock.calls[0][0].captureUpdate).toBe('IMMEDIATELY');
  });

  it('works with real sticky notes and selects the cards, not their texts', async () => {
    const note = createStickyNote(STICKY_COLORS[0], { x: 0, y: 0 });
    const { api, updateScene } = fakeApi([...createStickyNote(STICKY_COLORS[1], { x: 0, y: 0 })]);

    expect(await insertFile(api, file(note))).toBe(2);

    const call = updateScene.mock.calls[0][0];
    const added = (call.elements as ExcalidrawElement[]).slice(2);
    const [card, text] = added as unknown as [{ id: string }, { containerId: string }];
    expect(text.containerId).toBe(card.id);
    expect(Object.keys(call.appState.selectedElementIds)).toEqual([card.id]);
  });

  it('does not touch the board when the file is not an Excalidraw file or has no elements', async () => {
    const { api, updateScene } = fakeApi([rect('old')]);

    await expect(insertFile(api, new Blob(['nope']))).rejects.toThrow(
      'This is not an Excalidraw file.',
    );
    expect(await insertFile(api, file([]))).toBe(0);
    expect(updateScene).not.toHaveBeenCalled();
  });
});
