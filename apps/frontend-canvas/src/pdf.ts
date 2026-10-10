// Excalidraw has no PDF export: the board's SVG export is converted with jsPDF and svg2pdf.js (ADR 0013).
// Both libraries are loaded when a PDF is made, so they are not part of the initial bundle.

/** jsPDF's `px_scaling` hotfix makes one CSS pixel 0.75 points, the unit of a PDF page. */
const POINTS_PER_PIXEL = 0.75;

/** The largest page Acrobat opens, 14,400 points (200 inches), in pixels. */
export const MAX_PAGE_PX = 14_400 / POINTS_PER_PIXEL;

/**
 * The size of the PDF page for content of this size: the content itself, scaled down uniformly when its
 * longer side is more than a PDF page can be.
 */
export function pageSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_PAGE_PX / Math.max(width, height));
  return { width: width * scale, height: height * scale };
}

/**
 * Excalidraw's font families are not known to svg2pdf.js, which then falls back to a serif font. The PDF
 * has Helvetica built in, so text is set in it (it carries no font data and looks like the canvas's
 * sans-serif).
 */
export function setTextInHelvetica(svg: SVGSVGElement): void {
  for (const text of svg.querySelectorAll('text, tspan')) {
    text.setAttribute('font-family', 'helvetica');
  }
}

/** A4 and Letter in CSS pixels (96 per inch), portrait. */
const PAGE_FORMATS = {
  a4: { width: 793.7, height: 1122.52 },
  letter: { width: 816, height: 1056 },
} as const;

/** The space around the content of a page of a fixed format, in pixels, and the band for a page's title above it. */
const MARGIN = 38;
const TITLE_BAND = 30;

export interface PdfLayout {
  format?: 'fit' | 'a4' | 'letter';
  orientation?: 'auto' | 'portrait' | 'landscape';
}

export interface PlacedPage {
  /** The page, in pixels. */
  page: { width: number; height: number };
  /** Where the content goes on it, in pixels. */
  content: { x: number; y: number; width: number; height: number };
  orientation: 'portrait' | 'landscape';
}

/**
 * The page for content of a given size and where the content sits on it. `fit` makes the page as large as the content (plus a
 * band for the title, when there is one), scaled down uniformly when a PDF page cannot be that large; A4 and Letter have a margin
 * and the content is scaled, up or down, to the largest size that fits and centered, the page turned the way the content is shaped
 * unless an orientation is given.
 */
export function placePage(
  content: { width: number; height: number },
  withTitle: boolean,
  layout: PdfLayout = {},
): PlacedPage {
  const band = withTitle ? TITLE_BAND : 0;
  const format = layout.format ?? 'fit';
  if (format === 'fit') {
    const page = pageSize(content.width, content.height + band);
    const scale = page.width / content.width;
    return {
      page,
      content: {
        x: 0,
        y: band * scale,
        width: content.width * scale,
        height: content.height * scale,
      },
      orientation: page.width > page.height ? 'landscape' : 'portrait',
    };
  }
  const base = PAGE_FORMATS[format];
  const landscape =
    layout.orientation === 'landscape' ||
    (layout.orientation !== 'portrait' && content.width > content.height);
  const page = landscape ? { width: base.height, height: base.width } : { ...base };
  const boxWidth = page.width - 2 * MARGIN;
  const boxHeight = page.height - 2 * MARGIN - band;
  const scale = Math.min(boxWidth / content.width, boxHeight / content.height);
  const width = content.width * scale;
  const height = content.height * scale;
  return {
    page,
    content: {
      x: MARGIN + (boxWidth - width) / 2,
      y: MARGIN + band + (boxHeight - height) / 2,
      width,
      height,
    },
    orientation: landscape ? 'landscape' : 'portrait',
  };
}

export interface PdfPage {
  svg: SVGSVGElement;
  /** A line above the content, the name of a frame. */
  title?: string;
}

/** A one-page PDF with the content of the SVG; the page has the size of the SVG (see {@link pageSize}). */
export async function svgToPdf(svg: SVGSVGElement): Promise<Blob> {
  return svgsToPdf([{ svg }]);
}

/**
 * A PDF with one page per entry: the content of each SVG (text in Helvetica), laid out by {@link placePage}, with its title
 * as a line above when it has one. The first page decides how the document starts; every page has its own size.
 */
export async function svgsToPdf(pages: readonly PdfPage[], layout: PdfLayout = {}): Promise<Blob> {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  let document: InstanceType<typeof jsPDF> | null = null;
  for (const { svg, title } of pages) {
    const width = Number(svg.getAttribute('width'));
    const height = Number(svg.getAttribute('height'));
    // A page smaller than the content is the same drawing scaled, which svg2pdf takes from the viewBox.
    if (!svg.hasAttribute('viewBox')) {
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    }
    setTextInHelvetica(svg);
    const placed = placePage({ width, height }, title !== undefined, layout);
    const size: [number, number] = [placed.page.width, placed.page.height];
    if (document === null) {
      document = new jsPDF({
        unit: 'px',
        format: size,
        orientation: placed.orientation,
        compress: true,
        hotfixes: ['px_scaling'],
      });
    } else {
      document.addPage(size, placed.orientation);
    }
    if (title !== undefined) {
      document.setFont('helvetica', 'bold');
      document.setFontSize(14);
      const margin = layout.format === undefined || layout.format === 'fit' ? 8 : MARGIN;
      // A bookmark per page too: the pages can be found in a viewer's outline, and the titles are readable in the file.
      document.outline.add(null, title, { pageNumber: document.getNumberOfPages() });
      document.text(title, margin, margin + 14, { maxWidth: placed.page.width - 2 * margin });
    }
    await svg2pdf(svg, document, {
      x: placed.content.x,
      y: placed.content.y,
      width: placed.content.width,
      height: placed.content.height,
    });
  }
  if (document === null) throw new Error('A PDF needs at least one page.');
  return new Blob([document.output('arraybuffer')], { type: 'application/pdf' });
}
