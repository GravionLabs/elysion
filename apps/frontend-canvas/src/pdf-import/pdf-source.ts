import type { PDFDocumentProxy } from 'pdfjs-dist';
import { MAX_PDF_BYTES, renderSize } from './pdf-pages';

/** Why a PDF could not be opened; the canvas turns each into a message. */
export type PdfProblem = 'encrypted' | 'too-large' | 'invalid';

export class PdfError extends Error {
  constructor(readonly problem: PdfProblem) {
    super(problem);
    this.name = 'PdfError';
  }
}

export interface OpenedPdf {
  readonly pageCount: number;
  /** Height over width of a page (its proportions, with the page's own rotation). */
  aspectOf(page: number): Promise<number>;
  /** A page as a picture `width` pixels wide (the height follows), or `null` when the signal was aborted. */
  render(page: number, width: number, signal?: AbortSignal): Promise<Blob | null>;
  destroy(): void;
}

/**
 * Where pdf.js finds its fonts, character maps and decoders: next to this bundle (`vite.element.config.ts` copies them). The
 * address is made with string operations on purpose: Vite turns `new URL(<template>, import.meta.url)` into an asset lookup, which
 * finds nothing for a folder that is only copied.
 */
function resource(path: string): string {
  return `${import.meta.url.replace(/[^/]*$/, '')}pdfjs/${path}`;
}

/**
 * Opens a PDF in the browser (pdf.js, in a worker, loaded only now: the initial bundle has none of it). The file never goes to a
 * server. pdf.js 6 has no `eval` path to switch off (the Content-Security-Policy has no `unsafe-eval`; a browser test fails on a
 * violation), and the fonts, character maps and decoders come from this origin, not from a CDN.
 */
export async function openPdf(file: Blob): Promise<OpenedPdf> {
  if (file.size > MAX_PDF_BYTES) throw new PdfError('too-large');
  const pdfjs = await import('pdfjs-dist');
  // The worker is a file next to the bundle, not an `?url` import: in a library build Vite writes an asset into the code as a
  // `data:` URL, which the Content-Security-Policy refuses for a script.
  pdfjs.GlobalWorkerOptions.workerSrc = resource('pdf.worker.js');
  let document: PDFDocumentProxy;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: resource('cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: resource('standard_fonts/'),
    wasmUrl: resource('wasm/'),
    iccUrl: resource('iccs/'),
  });
  try {
    document = await task.promise;
  } catch (error) {
    console.warn('pdf.js could not open the file', error);
    void task.destroy();
    throw new PdfError(
      (error as { name?: string })?.name === 'PasswordException' ? 'encrypted' : 'invalid',
    );
  }
  return {
    pageCount: document.numPages,
    async aspectOf(number) {
      const viewport = (await document.getPage(number)).getViewport({ scale: 1 });
      return viewport.height / viewport.width;
    },
    async render(number, width, signal) {
      const page = await document.getPage(number);
      const unit = page.getViewport({ scale: 1 });
      const size = renderSize(unit.height / unit.width, width);
      const viewport = page.getViewport({ scale: size.width / unit.width });
      const canvas = globalThis.document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const rendering = page.render({ canvas, viewport });
      signal?.addEventListener('abort', () => rendering.cancel(), { once: true });
      try {
        await rendering.promise;
      } catch (error) {
        if (signal?.aborted || (error as { name?: string })?.name === 'RenderingCancelledException')
          return null;
        throw new PdfError('invalid');
      }
      if (signal?.aborted) return null;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      canvas.width = 0; // let the browser have the memory back
      return blob;
    },
    destroy() {
      void task.destroy();
    },
  };
}
