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

/** A one-page PDF with the content of the SVG; the page has the size of the SVG (see {@link pageSize}). */
export async function svgToPdf(svg: SVGSVGElement): Promise<Blob> {
  const width = Number(svg.getAttribute('width'));
  const height = Number(svg.getAttribute('height'));
  const page = pageSize(width, height);
  // A page smaller than the content is the same drawing scaled, which svg2pdf takes from the viewBox.
  if (!svg.hasAttribute('viewBox')) {
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }
  setTextInHelvetica(svg);

  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  const document = new jsPDF({
    unit: 'px',
    format: [page.width, page.height],
    orientation: page.width > page.height ? 'landscape' : 'portrait',
    compress: true,
    hotfixes: ['px_scaling'],
  });
  await svg2pdf(svg, document, { x: 0, y: 0, width: page.width, height: page.height });
  return new Blob([document.output('arraybuffer')], { type: 'application/pdf' });
}
