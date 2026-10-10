import { TestBed } from '@angular/core/testing';
import { PDFDocument } from 'pdf-lib';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardApi } from '../board/board-api';
import { CanvasElementLoader } from '../board/canvas-element-loader';
import { FilesApi } from '../board/files-api';
import { DEFAULT_EXPORT_SETTINGS } from '../topbar/export-settings';
import { RoomPdfExporter, type RoomExportProgress } from './room-pdf-export';

/** What a board does in the stand-in for `<elysion-canvas>`: whether it syncs, and the PDF it exports (pages), `null` for an empty board. */
const behaviour = new Map<
  string,
  { sync: boolean; pages: number | null; exportDelayMs?: number }
>();
const opened: string[] = [];

async function pdfOf(pages: number): Promise<Blob> {
  const document = await PDFDocument.create();
  for (let i = 0; i < pages; i++) document.addPage([300, 200]);
  return new Blob([(await document.save()) as BlobPart], { type: 'application/pdf' });
}

class StubCanvas extends HTMLElement {
  tokenProvider?: () => Promise<string | null>;
  fileStore?: unknown;
  connectedCallback() {
    opened.push(this.getAttribute('board-id') ?? '');
    if (behaviour.get(this.getAttribute('board-id') ?? '')?.sync) {
      queueMicrotask(() => this.dispatchEvent(new CustomEvent('synced')));
    }
  }
  whenSettled() {
    return Promise.resolve();
  }
  async exportBoard(): Promise<Blob | null> {
    const entry = behaviour.get(this.getAttribute('board-id') ?? '');
    if (entry?.exportDelayMs)
      await new Promise((resolve) => setTimeout(resolve, entry.exportDelayMs));
    return entry?.pages == null ? null : pdfOf(entry.pages);
  }
}

describe('RoomPdfExporter', () => {
  let exporter: RoomPdfExporter;
  const texts = {
    board: (index: number, total: number) => `Board ${index} of ${total}`,
    unreadable: 'could not be loaded',
    empty: 'is empty',
  };
  const fast = { syncMs: 50, imagesMs: 50 };

  beforeAll(() => {
    if (!customElements.get('elysion-canvas')) customElements.define('elysion-canvas', StubCanvas);
  });

  beforeEach(() => {
    behaviour.clear();
    opened.length = 0;
    TestBed.configureTestingModule({
      providers: [
        { provide: BoardApi, useValue: { realtimeToken: vi.fn() } },
        { provide: FilesApi, useValue: { storeFor: () => ({ put: vi.fn(), get: vi.fn() }) } },
        { provide: CanvasElementLoader, useValue: { load: async () => undefined } },
      ],
    });
    exporter = TestBed.inject(RoomPdfExporter);
  });

  const run = (
    boards: { id: string; name: string }[],
    extra: Partial<Parameters<RoomPdfExporter['export']>[2]> = {},
  ) =>
    exporter.export(boards, DEFAULT_EXPORT_SETTINGS, {
      signal: new AbortController().signal,
      onProgress: () => undefined,
      texts,
      timings: fast,
      ...extra,
    });

  it('makes a title page per board and then the pages of the board, in the order of the boards', async () => {
    behaviour.set('a', { sync: true, pages: 2 });
    behaviour.set('b', { sync: true, pages: 3 });

    const { pdf, skipped } = await run([
      { id: 'a', name: 'Retro' },
      { id: 'b', name: 'Plan' },
    ]);

    expect(skipped).toEqual([]);
    const document = await PDFDocument.load(await pdf!.arrayBuffer());
    expect(document.getPageCount()).toBe(1 + 2 + 1 + 3);
    expect(opened).toEqual(['a', 'b']); // one after the other
  });

  it('gives an empty board a title page and nothing behind it', async () => {
    behaviour.set('a', { sync: true, pages: null });

    const { pdf, skipped } = await run([{ id: 'a', name: 'Blank' }]);

    expect((await PDFDocument.load(await pdf!.arrayBuffer())).getPageCount()).toBe(1);
    expect(skipped).toEqual([]);
  });

  it('skips a board that does not load, with a title page, and goes on with the next', async () => {
    behaviour.set('broken', { sync: false, pages: 2 });
    behaviour.set('fine', { sync: true, pages: 1 });

    const { pdf, skipped } = await run([
      { id: 'broken', name: 'Broken' },
      { id: 'fine', name: 'Fine' },
    ]);

    expect(skipped).toEqual(['Broken']);
    expect((await PDFDocument.load(await pdf!.arrayBuffer())).getPageCount()).toBe(1 + 1 + 1);
  });

  it('reports the progress before each board and when it is done', async () => {
    behaviour.set('a', { sync: true, pages: 1 });
    behaviour.set('b', { sync: true, pages: 1 });
    const seen: RoomExportProgress[] = [];

    await run(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      { onProgress: (progress) => seen.push(progress) },
    );

    expect(seen).toEqual([
      { done: 0, total: 2, current: 'A' },
      { done: 1, total: 2, current: 'B' },
      { done: 2, total: 2, current: '' },
    ]);
  });

  it('can be canceled: no PDF, and no board after that is opened', async () => {
    behaviour.set('a', { sync: true, pages: 1, exportDelayMs: 30 });
    behaviour.set('b', { sync: true, pages: 1 });
    const abort = new AbortController();

    const pending = run(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      { signal: abort.signal },
    );
    setTimeout(() => abort.abort(), 5);

    expect((await pending).pdf).toBeNull();
    expect(opened).toEqual(['a']);
  });

  it('removes the hidden canvas again, whatever happened', async () => {
    behaviour.set('a', { sync: false, pages: 1 });

    await run([{ id: 'a', name: 'A' }]);

    expect(document.querySelectorAll('elysion-canvas')).toHaveLength(0);
  });

  it('writes a board name that Helvetica cannot show without throwing', async () => {
    behaviour.set('a', { sync: true, pages: 1 });

    const { pdf } = await run([{ id: 'a', name: 'Plan 計画 🚀' }]);

    expect((await PDFDocument.load(await pdf!.arrayBuffer())).getPageCount()).toBe(2);
  });
});
