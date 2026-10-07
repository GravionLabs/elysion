# Elysion brand

## Project icon: three candidates

Issue #556 (PBI #555). The owner picks one; the chosen icon becomes the favicon, the app icon and the mark in the app
(#557, #558). All three are hand-drawn SVGs on a 64 x 64 grid (plain `rect`, `path` and one gradient, no fonts,
filters or rasters), use the colors of the product, `--c-primary` `#6366f1` to `--c-node-purple` `#8b5cf6` at 135
degrees (the gradient the mark in the app already has), and share the rounded square, so the choice is about the
symbol only. Each was rendered at 16, 32 and 128 px on both page backgrounds (`#f4f5f7` and `#1a1c23`) and looked at.

| Candidate                                        | Symbol                                                  | Rationale                                                                                                                                                                                                     | At 16 px                                                              |
| ------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [A](candidates/a.svg): the E monogram            | An "E" built from rounded bars, the middle one shorter. | The name first: it keeps what the app's mark says today (the letter E on the gradient) but draws it as shapes, so it looks the same everywhere and needs no font.                                             | Clearest of the three; the three arms stay apart.                     |
| [B](candidates/b.svg): two sticky notes          | Two overlapping notes, the front one with text lines.   | The product's core object: the sticky note is what people make most on a board, and the same notes are in the template previews and the toolbar. Tells "whiteboard" at a glance, says nothing about the name. | Readable as two squares; the text lines on the front note blur.       |
| [C](candidates/c.svg): two nodes and a connector | Two rounded nodes joined by a right-angled connector.   | The newest, most distinctive feature (connectors, M8) and a symbol of collaboration: things linked together. The most unusual of the three, and the least obviously a board.                                  | The weakest: the connector is thin and the two nodes merge into dots. |

All three keep their shape on both backgrounds, because the gradient square carries the mark: the symbol is white and
never touches the page color.

### Recommendation

**A** for the favicon and the small sizes (the E is the only symbol that is still unmistakable at 16 px), and it is the
smallest step from the mark users already know. **B** is the better picture of the product and would be the choice if the
icon should explain itself to a stranger rather than be recognized by the people who use it. C is the one to pick only
if the connector is meant to become the product's signature.

### The files

- [`candidates/a.svg`](candidates/a.svg)
- [`candidates/b.svg`](candidates/b.svg)
- [`candidates/c.svg`](candidates/c.svg)
