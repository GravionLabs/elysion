import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { CanvasElement } from './canvas-element';

/** An editor who leaves a board and comes back within this long does not make a second picture: the first is recent enough. */
export const MIN_THUMBNAIL_INTERVAL_MS = 30_000;

/**
 * Makes the picture of a board's card (#729): when an editor leaves the board, the canvas renders it (480 by 300, light theme)
 * and the picture is stored through the BFF, so that the card on the overview shows what the board looks like. At most once per
 * {@link MIN_THUMBNAIL_INTERVAL_MS} per board; an empty board has no picture; a failure is silent (the card keeps its initials).
 */
@Injectable({ providedIn: 'root' })
export class ThumbnailUploader {
  readonly #http = inject(HttpClient);
  readonly #lastAt = new Map<string, number>();

  /** Whether a picture was made for this board recently, so that another one is not worth it. */
  recently(boardId: string, now = Date.now()): boolean {
    const last = this.#lastAt.get(boardId);
    return last !== undefined && now - last < MIN_THUMBNAIL_INTERVAL_MS;
  }

  /**
   * Starts making and storing the picture of a board: `rendered` settles when the canvas has drawn it (the part that needs the
   * canvas to be there), `done` when it is stored (`true`) or when nothing was stored (`false`). `null` when no picture is due:
   * the canvas cannot make one, or one was made lately. A failure is silent.
   */
  start(
    boardId: string,
    canvas: CanvasElement | null | undefined,
    now = Date.now(),
  ): { rendered: Promise<void>; done: Promise<boolean> } | null {
    if (!canvas?.exportThumbnail || this.recently(boardId, now)) {
      return null;
    }
    // Marked first: a second call during the render (the route change and the tab hiding together) must not render again.
    this.#lastAt.set(boardId, now);
    const render = canvas.exportThumbnail();
    const rendered = render.then(
      () => undefined,
      () => undefined,
    );
    const done = (async () => {
      try {
        const picture = await render;
        if (!picture) {
          this.#lastAt.delete(boardId);
          return false;
        }
        await firstValueFrom(
          this.#http.put<void>(`/api/boards/${boardId}/thumbnail`, picture, {
            headers: { 'Content-Type': 'image/png' },
          }),
        );
        return true;
      } catch {
        this.#lastAt.delete(boardId);
        return false;
      }
    })();
    return { rendered, done };
  }

  async save(
    boardId: string,
    canvas: CanvasElement | null | undefined,
    now = Date.now(),
  ): Promise<boolean> {
    return (await this.start(boardId, canvas, now)?.done) ?? false;
  }
}
