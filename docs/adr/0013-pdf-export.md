# ADR 0013: PDF export in the browser from the SVG export

- Status: proposed (waiting for the product owner; see "Decisions for the owner")
- Date: 2026-10-05
- Issues: #234, #235, #23
- Builds on: [ADR 0010](0010-shell-controls-the-canvas.md)

## Context

The Export menu offers PNG, SVG and the `.excalidraw` file, all made in the browser with Excalidraw's own
helpers (`exportToBlob`, `exportToSvg`, `serializeAsJSON`). Feature #104 also names PDF, and PBI #234 asks
for a PDF of the whole board or of the selection: one page sized to the content, with the board's
background, text kept as text where possible, and the board's images and arrows as on the canvas.
Excalidraw has no PDF export. The backlog also holds the export service (#23, in the business backend),
which was planned before the client-side exports existed.

## Prototype and measurements

A throwaway page (not in the repository) built boards of sticky-note-style cards (a rounded rectangle with
two lines of text, German umlauts and a dash) and arrows between every third pair, exported the scene with
`exportToSvg`, and made a PDF in Chrome in two ways. The PDFs were checked with poppler (`pdfinfo`,
`pdffonts`, `pdftotext`, `pdftoppm`, `pdfimages`).

| Board            | Elements | SVG export | A: vector PDF (jsPDF + svg2pdf.js) | B: PNG at 2x embedded (pdf-lib)       |
| ---------------- | -------: | ---------: | ---------------------------------: | ------------------------------------- |
| Small workshop   |       70 |   30–55 ms |                    9 KB, 70–120 ms | 296 KB, 1.5 s                         |
| Typical workshop |      700 |    ~110 ms |                   57 KB, 0.5–0.7 s | 2.2 MB, 9.4 s                         |
| Large board      |    3,500 |    ~590 ms |                      271 KB, 2.6 s | **failed**: "couldn't export to blob" |

What this shows:

- **The vector PDF is small and quick**: a typical board takes well under a second and a large one under three
  seconds, and the file stays small because shapes are paths and text is text.
- **The bitmap does not scale**: a few thousand elements make a page of 6,531 x 13,172 px; at 2x that is beyond
  the browser's canvas limits and the export fails. It is also ten times larger and slower for a typical board,
  and its text cannot be selected or searched.
- **Fidelity of the vector PDF**, by looking at the rendered page and the file: shapes with rounded corners,
  the tinted fills and the 1px borders, arrows with their heads, and the white page background are as on the
  canvas. The text is real text: `pdftotext` returns it with the umlauts and the dash. An image element is
  embedded as an image (`pdfimages` lists it) and renders in place.
- **Fonts are the one difference.** `svg2pdf.js` does not know Excalidraw's font families and falls back to a
  serif font (it looked like Times). Rewriting the `font-family` of the SVG's `text` elements to `helvetica`
  before the conversion gives the PDF's built-in Helvetica without any font file (checked with `pdffonts`),
  which looks like the canvas's sans-serif; Excalidraw's hand-drawn fonts become Helvetica too.
- **Size of the libraries**: jsPDF with svg2pdf.js is a chunk of 488 KB raw (155 KB gzipped); the build also
  emits optional chunks for features of jsPDF that the SVG path does not need (about 380 KB raw). All MIT.
  Loaded with a dynamic `import()` when the user picks PDF, none of it is in the initial bundle.
- A colour with transparency in an 8-digit hex form (`#3b82f622`) made svg2pdf paint the fill opaque in the
  first run. The app's own colours (the sticky notes' tinted fills, Excalidraw's palette) are solid or use
  `opacity`, which the prototype showed converting correctly; the implementation should still include a
  test with a semi-transparent fill.

## Options

**A. In the browser: the SVG export converted by jsPDF and svg2pdf.js.** The board never leaves the
browser. Vector output, text stays text.

**B. In the browser: the PNG export embedded in a PDF page.** Simple, but see the table: it fails on large
boards, is large and slow, and has no text.

**C. On the server (the export service #23): the scene or its SVG goes to the business backend through the
BFF, which makes the PDF** (for example with SkiaSharp and an SVG renderer, or a PDF library). The board's
content leaves the browser; the backend needs fonts, a rendering library and limits for large payloads; the
SVG that it would convert is made in the browser anyway.

**D. The browser's print dialog.** Opens a dialog, pages are a fixed paper size, not one page sized to the
content; not scriptable.

| Criterion                      | A: SVG to PDF in the browser                  | B: PNG in a PDF      | C: server                                     | D: print dialog        |
| ------------------------------ | --------------------------------------------- | -------------------- | --------------------------------------------- | ---------------------- |
| Text stays text, vector shapes | Yes                                           | No                   | Possible                                      | Yes                    |
| Large boards                   | 3,500 elements in 2.6 s                       | Fails                | Depends on payload limits                     | Paper size, many pages |
| One page sized to the content  | Yes                                           | Yes                  | Yes                                           | No                     |
| Privacy                        | Stays in the browser                          | Stays in the browser | Board content leaves the browser              | Stays                  |
| New code and dependencies      | Two MIT libraries, loaded on demand           | One library          | New endpoint, BFF route, rendering dependency | None                   |
| Running and maintaining        | Nothing on the servers                        | Nothing              | Service to run, scale and secure              | Nothing                |
| Fonts                          | Helvetica instead of Excalidraw's (see above) | As on canvas         | Needs the fonts installed                     | As on canvas           |

## Decision (proposed)

1. **Option A: PDF is made in the browser from the SVG export**, with jsPDF and svg2pdf.js loaded by a dynamic
   `import()` when PDF is chosen. `ExportFormat` gains `'pdf'`; the element resolves with an
   `application/pdf` Blob, or `null` for an empty board or selection, like the other formats.
2. **One page sized to the content**: the SVG's size plus the same padding as the other exports (16 px), the
   board's background, light colours like the PNG and SVG export. A PDF page may not exceed 14,400 points
   (200 inches, Acrobat's limit): content larger than that is scaled down uniformly so its longer side fits.
3. **Fonts: Helvetica.** The `font-family` of the SVG's text is set to `helvetica` before the conversion, so
   the PDF uses the viewer's built-in font and carries no font data. Embedding Excalidraw's own fonts would
   need TrueType files (the app ships WOFF2) and adds size; it is a possible later step, not part of this PBI.
4. **A visible state while it works**: converting a large board takes seconds on the main thread, so the menu
   shows "Preparing PDF…" and the item stays disabled until the file is ready; a failure gets a message.
5. **The export service (#23) is not needed.** PNG, SVG and PDF are made in the browser; #23 can be closed as not
   needed, and revisited only for a use that the browser cannot serve (scheduled or very large exports).

## Consequences

- No server work, no new endpoint and no board content leaving the browser; the cost is two lazily loaded
  libraries (about 155 KB gzipped on first use of PDF).
- The PDF's text is in Helvetica, not in Excalidraw's hand-drawn fonts, so the PDF does not look exactly like
  the canvas in that respect; shapes, colours, arrows and images do. This is the trade of point 3.
- The conversion runs on the main thread (svg2pdf needs the DOM), so a very large board freezes the page for
  a few seconds; the visible state of point 4 is the mitigation. The measured 3,500 elements took 2.6 s.
- Images are embedded as the SVG export carries them; a board with many large images makes a large PDF.
- If a board is wider or taller than the PDF page limit it is scaled down, which can make small text hard to
  read; the PBI's tests cover the scaling.

## Decisions for the owner

Accepting this ADR means agreeing to:

1. **Browser-side PDF** (A) from the SVG export, not a bitmap, a server or the print dialog.
2. **Helvetica instead of Excalidraw's fonts** in the PDF for now.
3. **Closing #23** (the export service) as not needed.

Set the status to accepted and remove the `needs-decision` label from #235 (and #234) to release #236 to #239.
