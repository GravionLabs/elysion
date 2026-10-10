import { useEffect, useMemo, useRef, useState } from 'react';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { useI18n } from '../i18n';
import { insertPdfPages } from './insert-pdf';
import { DEFAULT_WIDTH, MAX_PDF_PAGES, WIDTH_CHOICES } from './pdf-pages';
import { type OpenedPdf, PdfError, openPdf } from './pdf-source';

interface Props {
  file: File;
  api: ExcalidrawImperativeAPI;
  /** The dialog is done: how many pages were put on the board (0: nothing), and what to tell the person, if anything. */
  onDone: (inserted: number, notice?: string) => void;
}

const THUMBNAIL_WIDTH = 160;

/**
 * "Bring a PDF onto the board" (#725): the pages of a PDF as thumbnails, rendered in the browser with pdf.js (this component
 * and pdf.js are loaded only when a PDF is chosen or dropped). The person picks pages and a sharpness and imports; each page
 * becomes a picture in a frame. Progress per page, and it can be canceled at any time.
 */
export default function PdfImportDialog({ file, api, onDone }: Props) {
  const { t } = useI18n();
  const [pdf, setPdf] = useState<OpenedPdf | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [width, setWidth] = useState<number>(DEFAULT_WIDTH);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const abort = useRef(new AbortController());
  const pdfRef = useRef<OpenedPdf | null>(null);
  const skipped = useRef<number[]>([]);

  // Opens the file and draws the thumbnails one after the other.
  useEffect(() => {
    let gone = false;
    void (async () => {
      let opened: OpenedPdf;
      try {
        opened = await openPdf(file);
      } catch (error) {
        console.warn('The PDF could not be opened', error);
        const problem = error instanceof PdfError ? error.problem : 'invalid';
        if (!gone) {
          onDone(
            0,
            problem === 'encrypted'
              ? t.pdfEncrypted(file.name)
              : problem === 'too-large'
                ? t.pdfTooLarge(file.name)
                : t.pdfInvalid(file.name),
          );
        }
        return;
      }
      if (gone) {
        opened.destroy();
        return;
      }
      pdfRef.current = opened;
      setPdf(opened);
      const usable = Math.min(opened.pageCount, MAX_PDF_PAGES);
      setSelected(new Set(Array.from({ length: usable }, (_, i) => i + 1)));
      for (let page = 1; page <= usable; page++) {
        const blob = await opened.render(page, THUMBNAIL_WIDTH).catch(() => null);
        if (gone) break;
        if (blob) {
          const url = URL.createObjectURL(blob);
          setThumbnails((current) => ({ ...current, [page]: url }));
        }
      }
    })();
    const controller = abort.current;
    return () => {
      gone = true;
      controller.abort();
      pdfRef.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  useEffect(
    () => () => {
      for (const url of Object.values(thumbnailsRef.current)) URL.revokeObjectURL(url);
    },
    [],
  );
  const thumbnailsRef = useRef(thumbnails);
  thumbnailsRef.current = thumbnails;

  const usable = pdf ? Math.min(pdf.pageCount, MAX_PDF_PAGES) : 0;
  const pages = useMemo(() => [...selected].sort((a, b) => a - b), [selected]);
  const importing = progress !== null;

  const toggle = (page: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });

  const run = async () => {
    if (!pdf || pages.length === 0) return;
    setProgress({ done: 0, total: pages.length });
    try {
      const inserted = await insertPdfPages({
        api,
        pdf,
        pages,
        width,
        frameName: t.pdfPageName,
        signal: abort.current.signal,
        onProgress: (done, total) => setProgress({ done, total }),
        onSkipped: (page) => skipped.current.push(page),
      });
      const note =
        skipped.current.length > 0
          ? t.pdfPagesSkipped(skipped.current.join(', '))
          : inserted > 0
            ? t.pdfImported(inserted)
            : undefined;
      onDone(inserted, note);
    } catch {
      onDone(0, t.pdfInvalid(file.name));
    }
  };

  const cancel = () => {
    abort.current.abort();
    onDone(0);
  };

  return (
    <div className="elysion-pdf-backdrop" role="presentation">
      <div
        className="elysion-pdf-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="elysion-pdf-title"
        onKeyDown={(event) => event.key === 'Escape' && cancel()}
      >
        <h2 id="elysion-pdf-title">{t.pdfTitle(file.name)}</h2>
        {pdf === null ? (
          <p role="status">{t.pdfLoading}</p>
        ) : (
          <>
            {pdf.pageCount > MAX_PDF_PAGES && (
              <p role="note">{t.pdfTooManyPages(pdf.pageCount, MAX_PDF_PAGES)}</p>
            )}
            <div className="elysion-pdf-actions">
              <button
                type="button"
                disabled={importing}
                onClick={() =>
                  setSelected(new Set(Array.from({ length: usable }, (_, i) => i + 1)))
                }
              >
                {t.pdfSelectAll}
              </button>
              <button type="button" disabled={importing} onClick={() => setSelected(new Set())}>
                {t.pdfSelectNone}
              </button>
              <label>
                {t.pdfSharpness}{' '}
                <select
                  value={width}
                  disabled={importing}
                  onChange={(event) => setWidth(Number(event.target.value))}
                >
                  {WIDTH_CHOICES.map((choice) => (
                    <option key={choice} value={choice}>
                      {t.pdfWidthOption(choice)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <ul className="elysion-pdf-pages" aria-label={t.pdfPagesLabel}>
              {Array.from({ length: usable }, (_, index) => index + 1).map((page) => (
                <li key={page}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.has(page)}
                      disabled={importing}
                      onChange={() => toggle(page)}
                    />
                    {thumbnails[page] ? (
                      <img src={thumbnails[page]} alt="" />
                    ) : (
                      <span className="elysion-pdf-placeholder" aria-hidden="true" />
                    )}
                    <span>{t.pdfPageName(page)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
        {progress && (
          <p role="status">
            <progress value={progress.done} max={progress.total} />{' '}
            {t.pdfProgress(progress.done, progress.total)}
          </p>
        )}
        <div className="elysion-pdf-buttons">
          <button type="button" onClick={cancel}>
            {t.pdfCancel}
          </button>
          <button
            type="button"
            className="primary"
            disabled={pdf === null || importing || pages.length === 0}
            onClick={() => void run()}
          >
            {t.pdfImportButton(pages.length)}
          </button>
        </div>
      </div>
    </div>
  );
}
