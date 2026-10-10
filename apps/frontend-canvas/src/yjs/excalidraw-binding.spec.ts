import { convertToExcalidrawElements, restoreAppState } from '@excalidraw/excalidraw';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type {
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from '@excalidraw/excalidraw/types';
import * as Y from 'yjs';
import { describe, expect, it, vi } from 'vitest';
import { ExcalidrawYjsBinding } from './excalidraw-binding.js';
import type { FileStore } from './files.js';

function rectangle() {
  const [element] = convertToExcalidrawElements([
    { type: 'rectangle', x: 0, y: 0, width: 10, height: 10 },
  ]);
  return element;
}

function createMockApi(initialElements: readonly OrderedExcalidrawElement[]) {
  let elements = initialElements;
  const files: BinaryFiles = {};
  const addFiles = vi.fn((added: BinaryFileData[]) => {
    for (const file of added) files[file.id] = file;
  });
  const updateScene = vi.fn((sceneData: { elements?: readonly OrderedExcalidrawElement[] }) => {
    if (sceneData.elements) {
      elements = sceneData.elements;
    }
  });
  const api = {
    getSceneElementsIncludingDeleted: () => elements,
    getAppState: () => restoreAppState(null, null),
    getFiles: () => files,
    addFiles,
    updateScene,
  } as unknown as ExcalidrawImperativeAPI;
  return { api, updateScene, addFiles, files, elements: () => elements };
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

  it('leaves the scene alone when the stored element is the one the scene already has (our own write coming back)', () => {
    const doc = new Y.Doc();
    const rect = rectangle();
    const binding = new ExcalidrawYjsBinding(doc);
    const { api, updateScene, elements } = createMockApi([rect]);
    binding.attach(api);
    updateScene.mockClear();

    // The write fires the observer, which compares the stored copy with the scene's element: same version and nonce.
    binding.onLocalChange([rect]);

    expect(updateScene).not.toHaveBeenCalled();
    // The scene still holds its own object: Excalidraw changes some elements in place after they were written (an
    // image sets its fileId once the file is read), which must reach the element that is on the board.
    expect(elements()[0]).toBe(rect);
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

describe('ExcalidrawYjsBinding limit and replacement (ADR 0026)', () => {
  it('does not write an element that would take the board over the limit, takes it off the scene and says so', () => {
    const doc = new Y.Doc();
    const onLimit = vi.fn();
    const binding = new ExcalidrawYjsBinding(doc, { maxElements: () => 2, onLimit });
    const [a, b, c] = [rectangle(), rectangle(), rectangle()];
    const mock = createMockApi([a, b, c]);
    binding.attach(mock.api);

    binding.onLocalChange([a, b, c]);

    expect(doc.getMap('elements').size).toBe(2);
    expect(doc.getMap('elements').has(c.id)).toBe(false);
    expect(onLimit).toHaveBeenCalledOnce();
    expect(mock.elements().find((element) => element.id === c.id)?.isDeleted).toBe(true);
    expect(mock.elements().find((element) => element.id === a.id)?.isDeleted).toBe(false);
  });

  it('does not write the deletion of an element it refused, and does not say it twice', () => {
    const doc = new Y.Doc();
    const onLimit = vi.fn();
    const binding = new ExcalidrawYjsBinding(doc, { maxElements: () => 1, onLimit });
    const [a, b] = [rectangle(), rectangle()];
    const mock = createMockApi([a, b]);
    binding.attach(mock.api);
    binding.onLocalChange([a, b]);

    binding.onLocalChange(mock.elements());

    expect(doc.getMap('elements').has(b.id)).toBe(false);
    expect(onLimit).toHaveBeenCalledOnce();
  });

  it('counts deleted elements as free: deleting makes room', () => {
    const doc = new Y.Doc();
    const binding = new ExcalidrawYjsBinding(doc, { maxElements: () => 1 });
    const a = rectangle();
    binding.onLocalChange([a]);
    binding.onLocalChange([{ ...a, isDeleted: true, version: a.version + 1 }]);
    const b = rectangle();

    binding.onLocalChange([b]);

    expect(doc.getMap('elements').has(b.id)).toBe(true);
  });

  it('writes the scene into a new document: what it lacks, and what is newer than the stored version', () => {
    const doc = new Y.Doc();
    const binding = new ExcalidrawYjsBinding(doc);
    const [mine, theirs] = [rectangle(), rectangle()];
    const mock = createMockApi([mine, { ...theirs, version: 1 }]);
    doc.getMap('elements').set(theirs.id, { ...theirs, version: 5 }); // somebody changed it later, while this tab was away
    binding.attach(mock.api);

    binding.pushScene();

    expect(doc.getMap('elements').has(mine.id)).toBe(true);
    expect(
      (doc.getMap('elements').get(theirs.id) as { version: number }).version,
    ).toBeGreaterThanOrEqual(5);
  });
});

describe('ExcalidrawYjsBinding files (#702)', () => {
  // 1x1 transparent PNG
  const PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const FILE_ID = 'abcdef0123456789abcdef0123456789abcdef01';

  function image(fileId = FILE_ID): OrderedExcalidrawElement {
    return {
      ...rectangle(),
      type: 'image',
      fileId,
      status: 'saved',
    } as unknown as OrderedExcalidrawElement;
  }

  function fileData(id = FILE_ID): BinaryFileData {
    return { id, dataURL: PNG, mimeType: 'image/png', created: 1700000000000 } as BinaryFileData;
  }

  function memoryStore() {
    const stored = new Map<string, Blob>();
    const store: FileStore = {
      put: vi.fn((file: Blob, id: string) => {
        stored.set(id, file);
        return Promise.resolve();
      }),
      get: vi.fn((id: string) => {
        const file = stored.get(id);
        return file ? Promise.resolve(file) : Promise.reject(new Error('not found'));
      }),
    };
    return { store, stored };
  }

  it('uploads a new file and shares a reference without its bytes', async () => {
    const doc = new Y.Doc();
    const { store, stored } = memoryStore();
    const binding = new ExcalidrawYjsBinding(doc, { fileStore: () => store });

    binding.onLocalChange([image()], { [FILE_ID]: fileData() } as BinaryFiles);

    await vi.waitFor(() => expect(doc.getMap('files').get(FILE_ID)).toBeDefined());
    expect(stored.get(FILE_ID)?.type).toBe('image/png');
    expect(doc.getMap('files').get(FILE_ID)).toEqual({
      mimeType: 'image/png',
      created: 1700000000000,
    });
    expect(JSON.stringify(doc.getMap('files').toJSON())).not.toContain('data:');
    expect(JSON.stringify(doc.getMap('elements').toJSON())).not.toContain('data:');
  });

  it('uploads a file once however often the scene changes while it is uploading', async () => {
    const doc = new Y.Doc();
    const { store } = memoryStore();
    const binding = new ExcalidrawYjsBinding(doc, { fileStore: () => store });
    const scene = [image()];
    const files = { [FILE_ID]: fileData() } as BinaryFiles;

    binding.onLocalChange(scene, files);
    binding.onLocalChange(scene, files);
    await vi.waitFor(() => expect(doc.getMap('files').has(FILE_ID)).toBe(true));
    binding.onLocalChange(scene, files);

    expect(store.put).toHaveBeenCalledTimes(1);
  });

  it('does not upload a file the document already lists, or one no image shows', async () => {
    const doc = new Y.Doc();
    doc.getMap('files').set(FILE_ID, { mimeType: 'image/png', created: 1 });
    const { store } = memoryStore();
    const binding = new ExcalidrawYjsBinding(doc, { fileStore: () => store });

    binding.onLocalChange([image()], { [FILE_ID]: fileData() } as BinaryFiles);
    binding.onLocalChange([rectangle()], { other0000: fileData('other0000') } as BinaryFiles);
    await Promise.resolve();

    expect(store.put).not.toHaveBeenCalled();
  });

  it('keeps images local when the host gave no file store', () => {
    const doc = new Y.Doc();
    const binding = new ExcalidrawYjsBinding(doc);

    binding.onLocalChange([image()], { [FILE_ID]: fileData() } as BinaryFiles);

    expect(doc.getMap('files').size).toBe(0);
  });

  it('takes the image off the board and reports when the upload fails', async () => {
    const doc = new Y.Doc();
    const store: FileStore = {
      put: vi.fn(() => Promise.reject(new Error('A file is at most 10485760 bytes.'))),
      get: vi.fn(),
    };
    const onError = vi.fn();
    const binding = new ExcalidrawYjsBinding(doc, { fileStore: () => store, onError });
    const element = image();
    const { api, elements } = createMockApi([element]);
    binding.attach(api);

    binding.onLocalChange([element], { [FILE_ID]: fileData() } as BinaryFiles);

    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0][0].message).toBe('A file is at most 10485760 bytes.');
    expect(elements().find((e) => e.id === element.id)?.isDeleted).toBe(true);
    expect(doc.getMap('files').has(FILE_ID)).toBe(false);
  });

  it('settles at once when nothing is being fetched or uploaded', async () => {
    const binding = new ExcalidrawYjsBinding(new Y.Doc());

    const started = Date.now();
    await binding.whenSettled(5_000, 10);

    expect(Date.now() - started).toBeLessThan(500);
    expect(binding.pending).toBe(0);
  });

  it('waits for a file that is being fetched, and gives up after the timeout when it never arrives', async () => {
    const doc = new Y.Doc();
    let release!: (blob: Blob) => void;
    const store: FileStore = {
      put: vi.fn(),
      get: vi.fn(() => new Promise<Blob>((resolve) => (release = resolve))),
    };
    const element = image();
    doc.getMap('elements').set(element.id, element);
    doc.getMap('files').set(FILE_ID, { mimeType: 'image/png', created: 42 });
    const binding = new ExcalidrawYjsBinding(doc, { fileStore: () => store });
    const { api } = createMockApi([]);
    binding.attach(api);
    expect(binding.pending).toBe(1);

    let settled = false;
    const waiting = binding.whenSettled(5_000, 10).then(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(settled).toBe(false);

    release(new Blob([Uint8Array.from([137, 80, 78, 71])], { type: 'image/png' }));
    await waiting;
    expect(binding.pending).toBe(0);

    // A file that never comes: the wait ends at the timeout.
    const stuck = new ExcalidrawYjsBinding(doc, {
      fileStore: () => ({ put: vi.fn(), get: () => new Promise<Blob>(() => undefined) }),
    });
    stuck.attach(createMockApi([]).api);
    const before = Date.now();
    await stuck.whenSettled(80, 10);
    expect(Date.now() - before).toBeGreaterThanOrEqual(70);
  });

  it('loads the file of a remote image that the document lists', async () => {
    const doc = new Y.Doc();
    const { store, stored } = memoryStore();
    stored.set(FILE_ID, new Blob([Uint8Array.from([137, 80, 78, 71])], { type: 'image/png' }));
    const element = image();
    doc.getMap('elements').set(element.id, element);
    doc.getMap('files').set(FILE_ID, { mimeType: 'image/png', created: 42 });
    const binding = new ExcalidrawYjsBinding(doc, { fileStore: () => store });
    const { api, addFiles, files } = createMockApi([]);

    binding.attach(api);

    await vi.waitFor(() => expect(addFiles).toHaveBeenCalledTimes(1));
    expect(files[FILE_ID]).toMatchObject({
      id: FILE_ID,
      mimeType: 'image/png',
      created: 42,
      dataURL: expect.stringMatching(/^data:image\/png;base64,/),
    });
  });

  it('loads a file that is listed after its image arrived, and only once', async () => {
    const doc = new Y.Doc();
    const { store, stored } = memoryStore();
    stored.set(FILE_ID, new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/png' }));
    const element = image();
    doc.getMap('elements').set(element.id, element);
    const binding = new ExcalidrawYjsBinding(doc, { fileStore: () => store });
    const { api, addFiles } = createMockApi([]);
    binding.attach(api);
    expect(store.get).not.toHaveBeenCalled(); // not listed yet: nothing to fetch, no 404

    doc.getMap('files').set(FILE_ID, { mimeType: 'image/png', created: 1 });

    await vi.waitFor(() => expect(addFiles).toHaveBeenCalledTimes(1));
    doc.getMap('files').set('another-id', { mimeType: 'image/png', created: 2 }); // a later change
    await Promise.resolve();
    expect(store.get).toHaveBeenCalledTimes(1);
  });

  it('reports a file that cannot be loaded and tries again at the next change', async () => {
    const doc = new Y.Doc();
    let fail = true;
    const store: FileStore = {
      put: vi.fn(),
      get: vi.fn(() =>
        fail
          ? Promise.reject(new Error('down'))
          : Promise.resolve(new Blob([new Uint8Array(3)], { type: 'image/png' })),
      ),
    };
    const onError = vi.fn();
    const element = image();
    doc.getMap('elements').set(element.id, element);
    doc.getMap('files').set(FILE_ID, { mimeType: 'image/png', created: 1 });
    const binding = new ExcalidrawYjsBinding(doc, { fileStore: () => store, onError });
    const { api, addFiles } = createMockApi([]);
    binding.attach(api);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));

    fail = false;
    doc.getMap('files').set('another-id', { mimeType: 'image/png', created: 2 });

    await vi.waitFor(() => expect(addFiles).toHaveBeenCalledTimes(1));
  });

  it('carries an image from one client to the other through the store', async () => {
    const { store } = memoryStore();
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    docA.on('update', (update: Uint8Array) => Y.applyUpdate(docB, update));
    const a = new ExcalidrawYjsBinding(docA, { fileStore: () => store });
    const b = new ExcalidrawYjsBinding(docB, { fileStore: () => store });
    const apiB = createMockApi([]);
    b.attach(apiB.api);

    const element = image();
    a.onLocalChange([element], { [FILE_ID]: fileData() } as BinaryFiles);

    await vi.waitFor(() => expect(apiB.files[FILE_ID]?.dataURL).toBe(PNG));
  });
});
