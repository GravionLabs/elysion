import { ExportFormat } from './download';

/** The board's shared timer (ADR 0020), as the canvas announces it in its `timer` event. */
export interface TimerState {
  /** The length of the timer, including extensions. */
  durationMs: number;
  /** Epoch milliseconds the timer started (moved forward when it is resumed); the end is `startedAt + durationMs`. */
  startedAt: number;
  /** When it was paused, or `null` while it runs. */
  pausedAt: number | null;
  /** What was left when it was paused, or `null` while it runs. */
  remainingAtPauseMs: number | null;
  startedBy: { id: string; name: string };
}

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
  /**
   * Asked by the canvas before every connection to the board server for the board-scoped WS token: it resolves with
   * the token, or `null` when no connection is wanted (the shell has shown why); a rejection is retried with a
   * growing delay. A property, not an attribute: a token lives for about a minute.
   */
  tokenProvider?: () => Promise<string | null>;
  /** Replaces the board with an .excalidraw file; resolves with the number of elements in it. */
  importFile?(file: Blob): Promise<number>;
  /** Adds an .excalidraw file to the board around the view center, selected, as one undo step; resolves with the number of elements added. */
  insertFile?(file: Blob): Promise<number>;
  /**
   * The shared timer, for everybody on the board; each rejects on a read-only canvas and before the canvas is up. The
   * canvas keeps the state and announces it as the `timer` event; it does not draw the timer.
   */
  startTimer?(durationMs: number): Promise<void>;
  pauseTimer?(): Promise<void>;
  resumeTimer?(): Promise<void>;
  extendTimer?(ms: number): Promise<void>;
  stopTimer?(): Promise<void>;
};
