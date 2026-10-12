import { CaptureUpdateAction, newElementWith, reconcileElements } from '@excalidraw/excalidraw';
import type { RemoteExcalidrawElement } from '@excalidraw/excalidraw/data/reconcile';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type {
  BinaryFileData,
  BinaryFiles,
  DataURL,
  ExcalidrawImperativeAPI,
} from '@excalidraw/excalidraw/types';
import * as Y from 'yjs';
import { sceneToStored, storedToScene, recolor, wouldRecolor } from '../sticky-dark.js';
import { type FileReference, type FileStore, blobToDataUrl, dataUrlToBlob } from './files.js';

const ELEMENTS_MAP_KEY = 'elements';
const FILES_MAP_KEY = 'files';

/** The most live elements a board holds (ADR 0026): about 7.5 MB of document. A product limit, not a security one. */
export const MAX_ELEMENTS = 20_000;

export interface BindingOptions {
  /** The most live elements the board holds, read at every use; {@link MAX_ELEMENTS} when not given. */
  maxElements?: () => number | undefined;
  /** An element was not added because the board has {@link MAX_ELEMENTS} live elements; it was taken off the scene again. */
  onLimit?: () => void;
  /** Where the bytes of images live; read at every use, so a store the host sets later is used. Without one, images stay local. */
  fileStore?: () => FileStore | undefined;
  /** A file could not be stored or loaded. */
  onError?: (error: Error) => void;
}

/**
 * Whether an element of the scene replaces the stored one: it has a higher `version`, or the same `version` and the lower
 * `versionNonce` (the rule of Excalidraw's `reconcileElements`, so that the document and every screen agree on a tie).
 */
function beats(
  element: { version: number; versionNonce: number },
  stored: { version: number; versionNonce: number },
): boolean {
  return (
    element.version > stored.version ||
    (element.version === stored.version && element.versionNonce < stored.versionNonce)
  );
}

/**
 * Binds an Excalidraw scene to a shared Y.Doc: local edits are written into
 * a Y.Map<elementId, element> (never removed — Excalidraw already
 * soft-deletes via `isDeleted`, which doubles as a CRDT-friendly
 * tombstone), and remote map changes are merged back into the scene with
 * Excalidraw's own `reconcileElements` so an in-progress local edit never
 * gets clobbered by an incoming remote update.
 *
 * Feedback loops are avoided without an "applying remote update" flag: a
 * remote-applied element keeps the version number it arrived with, so the
 * next local onChange sees `version` unchanged and skips writing it back.
 *
 * Objects never cross the boundary by reference in either direction: writes
 * store a clone, and elements handed to the scene are clones of what the map
 * holds. Excalidraw mutates scene elements in place.
 *
 * The colors of sticky notes cross the boundary changed (#737): the document holds the stored, light colors that everybody shares;
 * in the dark theme the scene holds the colors that Excalidraw's filter turns into the dark palette (`sticky-dark.ts`). Everything
 * that comes in is mapped to the scene's colors for the theme, everything that is written is mapped back, and a switch of the theme
 * maps the scene again without writing anything (the version of an element is not changed by a color mapping).
 */
export class ExcalidrawYjsBinding {
  readonly #doc: Y.Doc;
  readonly #elements: Y.Map<OrderedExcalidrawElement>;
  readonly #files: Y.Map<FileReference>;
  readonly #options: BindingOptions;
  #api: ExcalidrawImperativeAPI | null = null;
  /** Ids being uploaded or fetched right now, so that a burst of changes does not start the same transfer twice. */
  readonly #uploading = new Set<string>();
  readonly #fetching = new Set<string>();
  /** Ids the limit refused: whatever the scene does with them later (their deletion) is not written either. */
  readonly #refused = new Set<string>();
  #destroyed = false;
  #theme: 'light' | 'dark' = 'light';
  #canonicalizing = false;

  constructor(doc: Y.Doc, options: BindingOptions = {}) {
    this.#doc = doc;
    this.#options = options;
    this.#elements = doc.getMap<OrderedExcalidrawElement>(ELEMENTS_MAP_KEY);
    this.#files = doc.getMap<FileReference>(FILES_MAP_KEY);
    this.#elements.observe(this.#handleRemoteChange);
    // A file that arrives after the element that shows it (the upload takes a moment): load it now.
    this.#files.observe(this.#loadMissingFiles);
  }

  /** The theme the scene is drawn in: the colors of the sticky notes in the scene follow it, the document does not. */
  setTheme(theme: 'light' | 'dark'): void {
    if (this.#theme === theme) return;
    this.#theme = theme;
    this.#canonicalize();
  }

  /** What a color of the stored document is in the scene, in this theme. */
  #sceneColor = (color: string): string =>
    this.#theme === 'dark' ? storedToScene(color) : sceneToStored(color);

  /**
   * Puts the colors of the scene into the form of the theme: the note colors as the dark theme wants them in the dark theme, the
   * stored ones in the light theme (also what was pasted from the other theme or undone across a switch). Only the colors change:
   * the elements keep their version, nothing is written to the document and nothing is an undo step.
   */
  #canonicalize(): void {
    const api = this.#api;
    if (!api || this.#canonicalizing) return;
    const elements = api.getSceneElementsIncludingDeleted();
    if (!wouldRecolor(elements, this.#sceneColor)) return;
    this.#canonicalizing = true;
    try {
      api.updateScene({
        elements: recolor(elements, this.#sceneColor),
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    } finally {
      this.#canonicalizing = false;
    }
  }

  attach(api: ExcalidrawImperativeAPI): void {
    this.#api = api;
    this.#handleRemoteChange();
  }

  destroy(): void {
    this.#destroyed = true;
    this.#elements.unobserve(this.#handleRemoteChange);
    this.#files.unobserve(this.#loadMissingFiles);
    this.#api = null;
  }

  /**
   * `files` is Excalidraw's cache of the images of the scene (with their bytes as data URLs). What is new in it and
   * shown by an image element is stored through the host's `FileStore`, and only then does a reference
   * (`{ mimeType, created }`, no bytes) go into the shared `files` map for the others.
   */
  onLocalChange = (elements: readonly OrderedExcalidrawElement[], files?: BinaryFiles): void => {
    this.#uploadNewFiles(elements, files);
    let live = 0;
    for (const stored of this.#elements.values()) {
      if (!stored.isDeleted) live += 1;
    }
    const refused: string[] = [];
    this.#doc.transact(() => {
      for (const element of elements) {
        if (this.#refused.has(element.id)) continue;
        const existing = this.#elements.get(element.id);
        if (!existing && !element.isDeleted) {
          // A new element that would take the board over the limit is not written (ADR 0026).
          if (live >= (this.#options.maxElements?.() ?? MAX_ELEMENTS)) {
            this.#refused.add(element.id);
            refused.push(element.id);
            continue;
          }
          live += 1;
        }
        if (!existing || beats(element, existing)) {
          // Excalidraw mutates its element objects in place; Y.Map.get()
          // returns the exact reference passed to .set(), so storing
          // `element` directly would make `existing` and `element` alias
          // the same object — the version comparison above would then
          // always read as "equal" (both sides mutate together) after the
          // first write, silently dropping every later update. Clone to
          // freeze a snapshot of this version.
          this.#elements.set(element.id, structuredClone(recolor([element], sceneToStored)[0]));
        }
      }
    });
    // A note that arrives in the other theme's colors (drawn just now, pasted, undone across a switch) is put right after this
    // change, not in the middle of it.
    if (wouldRecolor(elements, this.#sceneColor)) {
      queueMicrotask(() => this.#canonicalize());
    }
    if (refused.length > 0) {
      this.#takeOffScene(refused);
      this.#options.onLimit?.();
    }
  };

  /**
   * Writes what the scene holds into the document, by the rule of {@link onLocalChange}: an element goes in when the
   * document lacks it or has an older version. Used after the document was replaced (the board was rebuilt while this
   * client was away, ADR 0026) and the server's state has arrived, so that what was changed meanwhile is kept and what
   * others changed meanwhile is not overwritten.
   */
  pushScene(): void {
    const api = this.#api;
    if (api) {
      this.onLocalChange(api.getSceneElementsIncludingDeleted(), api.getFiles());
    }
  }

  /** How many files are being fetched or uploaded right now. */
  get pending(): number {
    return this.#fetching.size + this.#uploading.size;
  }

  /**
   * Resolves when nothing has been pending for a moment (the files that the scene shows are in), or after `timeoutMs`. A file
   * that is listed after its image arrived starts its fetch a moment later, so one quiet look is not enough: two, `quietMs` apart.
   */
  async whenSettled(timeoutMs = 20_000, quietMs = 150): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let quiet = 0;
    while (quiet < 2 && Date.now() < deadline && !this.#destroyed) {
      quiet = this.pending === 0 ? quiet + 1 : 0;
      await new Promise((resolve) => setTimeout(resolve, quietMs));
    }
  }

  #takeOffScene(ids: readonly string[]): void {
    const api = this.#api;
    if (!api) return;
    const gone = new Set(ids);
    const elements = api
      .getSceneElementsIncludingDeleted()
      .map((element) =>
        gone.has(element.id) && !element.isDeleted
          ? newElementWith(element, { isDeleted: true })
          : element,
      );
    api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
  }

  #handleRemoteChange = (): void => {
    const api = this.#api;
    if (!api) {
      return;
    }

    const localElements = api.getSceneElementsIncludingDeleted();
    // A stored copy that is the very version the scene has (our own write coming back through the observer) brings
    // nothing, and must not take part: with equal version and nonce `reconcileElements` picks the stored one, and the
    // scene would get a clone in place of its element. Excalidraw changes some elements in place after they were
    // written, an image that is still being read for one (it sets `fileId` on the element it holds), and that work
    // would land on an element that is no longer on the board.
    const localById = new Map(localElements.map((element) => [element.id, element]));
    const stored = Array.from(this.#elements.values()).filter((remote) => {
      const local = localById.get(remote.id);
      return !(
        local &&
        local.version === remote.version &&
        local.versionNonce === remote.versionNonce
      );
    });
    const reconciled = reconcileElements(
      localElements,
      stored as RemoteExcalidrawElement[],
      api.getAppState(),
    );

    // reconcileElements hands the stored objects themselves to the scene, and
    // Excalidraw then edits scene elements in place. Without a copy that edit
    // lands in the Y.Map behind Yjs's back: the version comparison in
    // onLocalChange sees "equal" and the change is never written, so later
    // moves of an already-synced element never reach the other peers. This
    // happens on the writer too, because Y.Map observers also fire for local
    // writes.
    const storedObjects = new Set<unknown>(stored);
    const isLight = this.#theme === 'light';
    const detached = reconciled.map((element) => {
      if (!storedObjects.has(element)) return element;
      const copy = structuredClone(element);
      return isLight ? copy : recolor([copy], storedToScene)[0];
    });

    // Our own write comes back through the observer with nothing new in it: leave the scene alone then. Replacing the
    // scene's elements while Excalidraw is in the middle of something with one of them (an image that is still
    // being read) throws that work away.
    const changed =
      detached.length !== localElements.length ||
      detached.some((element, index) => element !== localElements[index]);
    if (changed) {
      api.updateScene({ elements: detached, captureUpdate: CaptureUpdateAction.NEVER });
    }
    // Two people who changed the same element while apart, each the same number of times, have the same `version`: Excalidraw
    // keeps the one with the lower `versionNonce` on both screens, but the document keeps the one that Yjs happened to pick.
    // The scene's element that wins by Excalidraw's rule is written, so the document ends where the screens are.
    this.#doc.transact(() => {
      for (const element of detached) {
        if (storedObjects.has(element)) continue;
        const existing = this.#elements.get(element.id);
        if (existing && beats(element, existing)) {
          this.#elements.set(element.id, structuredClone(recolor([element], sceneToStored)[0]));
        }
      }
    });
    this.#loadMissingFiles();
  };

  #uploadNewFiles(
    elements: readonly OrderedExcalidrawElement[],
    files: BinaryFiles | undefined,
  ): void {
    const store = this.#options.fileStore?.();
    if (!store || !files) {
      return;
    }
    for (const id of shownFileIds(elements)) {
      const file = files[id];
      if (!file || this.#files.has(id) || this.#uploading.has(id)) {
        continue;
      }
      this.#uploading.add(id);
      void this.#upload(store, file).finally(() => this.#uploading.delete(id));
    }
  }

  async #upload(store: FileStore, file: BinaryFileData): Promise<void> {
    try {
      await store.put(dataUrlToBlob(file.dataURL), file.id);
    } catch (error) {
      // The others never get this image, so it must not stay on the author's board either: take the element away
      // (the deletion syncs like any other) and say why.
      this.#removeImage(file.id);
      this.#options.onError?.(asError(error, 'The image could not be stored.'));
      return;
    }
    if (!this.#destroyed) {
      this.#doc.transact(() => {
        this.#files.set(file.id, { mimeType: file.mimeType, created: file.created });
      });
    }
  }

  #removeImage(fileId: string): void {
    const api = this.#api;
    if (!api) {
      return;
    }
    const elements = api
      .getSceneElementsIncludingDeleted()
      .map((element) =>
        isImageOf(element, fileId) && !element.isDeleted
          ? newElementWith(element, { isDeleted: true })
          : element,
      );
    api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
  }

  /** Fetches the files that an image of the scene refers to, that the shared map lists and that Excalidraw does not have yet. */
  #loadMissingFiles = (): void => {
    const api = this.#api;
    const store = this.#options.fileStore?.();
    if (!api || !store) {
      return;
    }
    const known = api.getFiles();
    for (const id of shownFileIds(api.getSceneElementsIncludingDeleted())) {
      const reference = this.#files.get(id);
      if (!reference || known[id] || this.#fetching.has(id)) {
        continue;
      }
      this.#fetching.add(id);
      void this.#download(store, id, reference).finally(() => this.#fetching.delete(id));
    }
  };

  async #download(store: FileStore, id: string, reference: FileReference): Promise<void> {
    try {
      const dataURL = (await blobToDataUrl(await store.get(id))) as DataURL;
      if (this.#destroyed || !this.#api) {
        return;
      }
      this.#api.addFiles([
        {
          id: id as BinaryFileData['id'],
          dataURL,
          mimeType: reference.mimeType as BinaryFileData['mimeType'],
          created: reference.created,
          lastRetrieved: Date.now(),
        },
      ]);
    } catch (error) {
      this.#options.onError?.(asError(error, 'An image could not be loaded.'));
    }
  }
}

/** The ids of the files that the images of the scene show (a deleted image shows nothing). */
function shownFileIds(elements: readonly OrderedExcalidrawElement[]): Set<string> {
  const ids = new Set<string>();
  for (const element of elements) {
    if (element.type === 'image' && !element.isDeleted && element.fileId) {
      ids.add(element.fileId);
    }
  }
  return ids;
}

function isImageOf(element: OrderedExcalidrawElement, fileId: string): boolean {
  return element.type === 'image' && element.fileId === fileId;
}

function asError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}
