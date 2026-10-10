import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, LOCALE_ID, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { BoardApi } from '../board/board-api';
import { CANVAS_ELEMENT_SRC, CanvasElementLoader } from '../board/canvas-element-loader';
import type { CanvasElement } from '../board/canvas-element';
import { FilesApi } from '../board/files-api';
import { type ExportSettings, toCanvasOptions } from '../topbar/export-settings';

/** A board of the room, in the order of the room's page. */
export interface RoomExportBoard {
  id: string;
  name: string;
}

export interface RoomExportProgress {
  /** Boards finished, and how many there are. */
  done: number;
  total: number;
  /** The board being made now. */
  current: string;
}

export interface RoomExportResult {
  /** The PDF, or `null` when the export was canceled. */
  pdf: Blob | null;
  /** The boards that are in the PDF only as a title page with a note (they could not be loaded). */
  skipped: string[];
}

/** How long a board may take to connect and sync, and to load its images, before it is given up. */
export interface RoomExportTimings {
  syncMs: number;
  imagesMs: number;
}

export const DEFAULT_TIMINGS: RoomExportTimings = { syncMs: 30_000, imagesMs: 20_000 };

/** The notes a title page can carry, in the language of the page. */
export interface RoomExportTexts {
  board: (index: number, total: number) => string;
  unreadable: string;
  empty: string;
}

/**
 * Makes one PDF of a room (#727): every board is opened one after another in a hidden `<elysion-canvas>` (the element connects,
 * syncs and loads the images like on the board's page), exported as a PDF the way #726 makes it, and put behind a title page with
 * the board's name. A board that cannot be loaded gets a title page that says so. It takes a few seconds per board, so the caller
 * shows the progress and can cancel through the signal.
 */
@Injectable({ providedIn: 'root' })
export class RoomPdfExporter {
  readonly #api = inject(BoardApi);
  readonly #files = inject(FilesApi);
  readonly #loader = inject(CanvasElementLoader);
  readonly #src = inject(CANVAS_ELEMENT_SRC);
  readonly #locale = inject(LOCALE_ID);

  async export(
    boards: readonly RoomExportBoard[],
    settings: ExportSettings,
    options: {
      signal: AbortSignal;
      onProgress: (progress: RoomExportProgress) => void;
      texts: RoomExportTexts;
      timings?: RoomExportTimings;
    },
  ): Promise<RoomExportResult> {
    const { signal, onProgress, texts, timings = DEFAULT_TIMINGS } = options;
    await this.#loader.load(this.#src);
    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const bold = await document.embedFont(StandardFonts.HelveticaBold);
    const skipped: string[] = [];

    for (const [index, board] of boards.entries()) {
      if (signal.aborted) return { pdf: null, skipped };
      onProgress({ done: index, total: boards.length, current: board.name });
      let source: Blob | null = null;
      let note: string | null = null;
      try {
        source = await this.#renderBoard(board, settings, timings, signal);
        if (signal.aborted) return { pdf: null, skipped };
        if (source === null) note = texts.empty;
      } catch {
        if (signal.aborted) return { pdf: null, skipped };
        note = texts.unreadable;
        skipped.push(board.name);
      }

      // The title page: A4, the board's name, which board of how many it is, and a note when there is nothing behind it.
      const title = document.addPage([595.28, 841.89]);
      title.drawText(winAnsi(board.name, bold), {
        x: 56,
        y: 560,
        size: 28,
        font: bold,
        color: rgb(0.1, 0.1, 0.12),
        maxWidth: 480,
        lineHeight: 34,
      });
      title.drawText(texts.board(index + 1, boards.length), {
        x: 56,
        y: 520,
        size: 12,
        font,
        color: rgb(0.4, 0.4, 0.45),
      });
      if (note) {
        title.drawText(winAnsi(note, font), {
          x: 56,
          y: 490,
          size: 12,
          font,
          color: rgb(0.7, 0.2, 0.2),
        });
      }
      if (source !== null) {
        const part = await PDFDocument.load(await source.arrayBuffer());
        for (const page of await document.copyPages(part, part.getPageIndices())) {
          document.addPage(page);
        }
      }
    }
    onProgress({ done: boards.length, total: boards.length, current: '' });
    const bytes = await document.save();
    return { pdf: new Blob([bytes as BlobPart], { type: 'application/pdf' }), skipped };
  }

  /** One board's PDF made in a hidden canvas, or `null` when the board is empty. Rejects when the board cannot be loaded. */
  async #renderBoard(
    board: RoomExportBoard,
    settings: ExportSettings,
    timings: RoomExportTimings,
    signal: AbortSignal,
  ): Promise<Blob | null> {
    const host = document.createElement('div');
    // Off the screen but laid out: the canvas needs a size to draw into, and nobody should see it.
    host.style.cssText =
      'position:fixed;left:-10000px;top:0;width:1280px;height:800px;pointer-events:none';
    host.setAttribute('aria-hidden', 'true');
    const canvas = document.createElement('elysion-canvas') as CanvasElement;
    canvas.setAttribute('board-id', board.id);
    canvas.setAttribute('readonly', '');
    canvas.setAttribute('images-enabled', '');
    canvas.setAttribute('locale', this.#locale.startsWith('de') ? 'de' : 'en');
    canvas.style.cssText = 'display:block;width:100%;height:100%';
    canvas.tokenProvider = async () => {
      try {
        return (await firstValueFrom(this.#api.realtimeToken(board.id))).token;
      } catch (error) {
        if (error instanceof HttpErrorResponse && error.status === 403) return null;
        throw error;
      }
    };
    canvas.fileStore = this.#files.storeFor(() => board.id);
    host.append(canvas);
    document.body.append(host);
    try {
      await waitFor(canvas, 'synced', timings.syncMs, signal);
      await canvas.whenSettled?.(timings.imagesMs);
      if (!canvas.exportBoard) throw new Error('The canvas is not ready.');
      return await canvas.exportBoard('pdf', toCanvasOptions(settings, false));
    } finally {
      host.remove();
    }
  }
}

/** Waits for an event of the element, or rejects after `ms` or when the signal fires. */
function waitFor(
  element: HTMLElement,
  name: string,
  ms: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (action: () => void) => {
      clearTimeout(timer);
      element.removeEventListener(name, onEvent);
      signal.removeEventListener('abort', onAbort);
      action();
    };
    const onEvent = () => done(resolve);
    const onAbort = () => done(() => reject(new Error('canceled')));
    const timer = setTimeout(() => done(() => reject(new Error(`no ${name} in ${ms} ms`))), ms);
    element.addEventListener(name, onEvent);
    signal.addEventListener('abort', onAbort);
  });
}

/** The text with what Helvetica's WinAnsi encoding cannot show replaced by `?`, so that drawing it does not throw. */
function winAnsi(text: string, font: { encodeText(text: string): unknown }): string {
  let result = '';
  for (const char of text) {
    try {
      font.encodeText(char);
      result += char;
    } catch {
      result += '?';
    }
  }
  return result;
}
