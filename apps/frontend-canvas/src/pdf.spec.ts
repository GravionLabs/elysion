import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_PAGE_PX, pageSize, placePage, svgToPdf, svgsToPdf, setTextInHelvetica } from './pdf';

/** What jsdom lacks and svg2pdf.js asks every element for. */
beforeEach(() => {
  (SVGElement.prototype as unknown as { getBBox: () => object }).getBBox = () => ({
    x: 0,
    y: 0,
    width: 50,
    height: 20,
  });
});

function svgOf(width: number, height: number, inner = '', viewBox = true): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  if (viewBox) svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML = inner;
  document.body.appendChild(svg);
  return svg;
}

/** The raw PDF as text: enough to count pages and read the page box and the fonts, which are not compressed. */
async function inspect(blob: Blob) {
  const text = new TextDecoder('latin1').decode(await blob.arrayBuffer());
  const box = text.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
  return {
    text,
    pages: (text.match(/\/Type \/Page\b/g) ?? []).length,
    width: Number(box?.[1]),
    height: Number(box?.[2]),
  };
}

describe('pageSize', () => {
  it('is the size of the content when it fits', () => {
    expect(pageSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(pageSize(MAX_PAGE_PX, 100)).toEqual({ width: MAX_PAGE_PX, height: 100 });
  });

  it('scales the content down uniformly when the longer side is above the PDF page limit', () => {
    const wide = pageSize(MAX_PAGE_PX * 2, MAX_PAGE_PX);
    expect(wide).toEqual({ width: MAX_PAGE_PX, height: MAX_PAGE_PX / 2 });

    const tall = pageSize(1000, 100_000);
    expect(tall.height).toBe(MAX_PAGE_PX);
    expect(tall.width / tall.height).toBeCloseTo(1000 / 100_000, 10);
  });

  it('limits a page to the 14,400 points Acrobat opens', () => {
    expect(MAX_PAGE_PX * 0.75).toBe(14_400);
  });
});

describe('setTextInHelvetica', () => {
  it('sets every text and tspan in Helvetica and leaves other elements alone', () => {
    const svg = svgOf(
      100,
      100,
      '<g font-family="Nunito"><text font-family="Virgil">a<tspan font-family="Nunito">b</tspan></text><rect/></g>',
    );

    setTextInHelvetica(svg);

    expect(svg.querySelector('text')?.getAttribute('font-family')).toBe('helvetica');
    expect(svg.querySelector('tspan')?.getAttribute('font-family')).toBe('helvetica');
    expect(svg.querySelector('g')?.getAttribute('font-family')).toBe('Nunito');
    expect(svg.querySelector('rect')?.hasAttribute('font-family')).toBe(false);
  });
});

describe('svgToPdf', () => {
  const content =
    '<rect x="10" y="10" width="50" height="30" fill="#ff0000"/>' +
    '<text x="20" y="80" font-family="Nunito" font-size="16">Hello PDF</text>';

  it('makes a PDF with exactly one page', async () => {
    const blob = await svgToPdf(svgOf(400, 200, content));

    expect(blob.type).toBe('application/pdf');
    const pdf = await inspect(blob);
    expect(pdf.text.startsWith('%PDF-')).toBe(true);
    expect(pdf.pages).toBe(1);
  });

  it('sizes the page to the content: pixels become points at 0.75', async () => {
    const pdf = await inspect(await svgToPdf(svgOf(400, 200, content)));

    expect(pdf.width).toBeCloseTo(300, 1);
    expect(pdf.height).toBeCloseTo(150, 1);
  });

  it('scales a board that is larger than a PDF page down to the page limit', async () => {
    const pdf = await inspect(await svgToPdf(svgOf(60_000, 3_000, content)));

    expect(pdf.width).toBeCloseTo(14_400, 0);
    expect(pdf.height).toBeCloseTo(720, 0);
    expect(pdf.pages).toBe(1);
  });

  it('sets the text in the built-in Helvetica, not in a font it would have to embed', async () => {
    const pdf = await inspect(await svgToPdf(svgOf(400, 200, content)));

    expect(pdf.text).toContain('/BaseFont /Helvetica');
    expect(pdf.text).not.toContain('Nunito');
  });

  it('takes the page size from width and height when the SVG has no viewBox', async () => {
    const pdf = await inspect(await svgToPdf(svgOf(400, 200, content, false)));

    expect(pdf.width).toBeCloseTo(300, 1);
  });
});

describe('placePage', () => {
  it('makes the page as large as the content when the format is fit, with a band above it for a title', () => {
    const plain = placePage({ width: 400, height: 200 }, false);
    const titled = placePage({ width: 400, height: 200 }, true);

    expect(plain.page).toEqual({ width: 400, height: 200 });
    expect(plain.content).toEqual({ x: 0, y: 0, width: 400, height: 200 });
    expect(titled.page.height).toBeGreaterThan(200);
    expect(titled.content.y).toBeGreaterThan(0);
  });

  it('gives A4 and Letter their sizes, portrait for content that is higher than wide and landscape otherwise', () => {
    const tall = placePage({ width: 100, height: 300 }, false, { format: 'a4' });
    const wide = placePage({ width: 300, height: 100 }, false, { format: 'a4' });
    const letter = placePage({ width: 100, height: 300 }, false, { format: 'letter' });

    expect(tall.page.width).toBeCloseTo(793.7, 1);
    expect(tall.page.height).toBeCloseTo(1122.52, 1);
    expect(tall.orientation).toBe('portrait');
    expect(wide.page.width).toBeCloseTo(1122.52, 1);
    expect(wide.orientation).toBe('landscape');
    expect(letter.page).toEqual({ width: 816, height: 1056 });
  });

  it('turns the page the way it is told, whatever the content', () => {
    const forced = placePage({ width: 300, height: 100 }, false, {
      format: 'a4',
      orientation: 'portrait',
    });

    expect(forced.orientation).toBe('portrait');
    expect(forced.page.height).toBeGreaterThan(forced.page.width);
  });

  it('scales the content to the largest size inside the margins and centers it', () => {
    const placed = placePage({ width: 100, height: 100 }, false, { format: 'a4' });

    expect(placed.content.width).toBeCloseTo(placed.content.height, 5);
    expect(placed.content.x).toBeCloseTo(38, 5); // the width is the limit: it fills the box
    expect(placed.content.y).toBeGreaterThan(38); // and is centered in the height
    expect(placed.content.x + placed.content.width).toBeCloseTo(placed.page.width - 38, 5);
  });
});

describe('svgsToPdf', () => {
  const content = '<rect x="10" y="10" width="50" height="30" fill="#ff0000"/>';

  it('makes one page per entry, each with a title that is text in the page', async () => {
    const blob = await svgsToPdf([
      { svg: svgOf(400, 200, content), title: 'First frame' },
      { svg: svgOf(300, 300, content), title: 'Second frame' },
      { svg: svgOf(200, 400, content), title: 'Third frame' },
    ]);

    const pdf = await inspect(blob);
    expect(pdf.pages).toBe(3);
    // Each title is a line on its page (a compressed stream) and a bookmark in the document's outline (readable in the file).
    expect(pdf.text).toContain('/Title (First frame)');
    expect(pdf.text).toContain('/Title (Third frame)');
  });

  it('gives every page of a fixed format the same size', async () => {
    const pdf = await inspect(
      await svgsToPdf([{ svg: svgOf(400, 200, content) }, { svg: svgOf(400, 200, content) }], {
        format: 'letter',
      }),
    );

    expect(pdf.pages).toBe(2);
    expect(pdf.width).toBeCloseTo(792, 0); // 816 px, 792 points
    expect(pdf.height).toBeCloseTo(612, 0); // landscape
  });

  it('refuses a document without a page', async () => {
    await expect(svgsToPdf([])).rejects.toThrow();
  });
});
