import { ExportFormat } from './download';

/**
 * The `<elysion-canvas>` custom element as the shell uses it: the standard element plus the methods
 * it exposes (see "Top bar and the element contract" in docs/specs/frontend.md). The element only has
 * them once its script has loaded, so callers treat a missing one as "not ready yet".
 */
export type CanvasElement = HTMLElement & {
  /** Opens the library sidebar, or closes it when it is open. */
  toggleLibrary?(): void;
  /** The board (or the selection) as a file, or `null` when there is nothing to export. */
  exportBoard?(format: ExportFormat, options?: { selectionOnly?: boolean }): Promise<Blob | null>;
  /** Replaces the board with an .excalidraw file; resolves with the number of elements in it. */
  importFile?(file: Blob): Promise<number>;
};
