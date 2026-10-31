import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { BoardSnapshotApi, BoardSnapshotInfo } from './canvas-element';

/**
 * What the canvas calls to reach the versions of a board (`snapshotApi` of `<elysion-canvas>`, ADR 0032, #846): the BFF's
 * routes under `/api/boards/:id/snapshots`. A refusal rejects with an error that carries the HTTP `status`; the canvas has
 * the words for it (it shows them in its own language).
 */
@Injectable({ providedIn: 'root' })
export class SnapshotApi {
  readonly #http = inject(HttpClient);

  /** The versions of one board, as the canvas wants them. `boardId` is read at every call, so it follows the page. */
  forBoard(boardId: () => string): BoardSnapshotApi {
    const base = () => `/api/boards/${encodeURIComponent(boardId())}/snapshots`;
    const withStatus = async <T>(call: Promise<T>): Promise<T> => {
      try {
        return await call;
      } catch (error) {
        throw Object.assign(
          new Error('The versions of the board could not be reached.', { cause: error }),
          { status: error instanceof HttpErrorResponse ? error.status : undefined },
        );
      }
    };
    return {
      list: () => withStatus(firstValueFrom(this.#http.get<BoardSnapshotInfo[]>(base()))),
      create: (name) =>
        withStatus(
          firstValueFrom(
            this.#http.post<BoardSnapshotInfo>(base(), name === undefined ? {} : { name }),
          ),
        ),
      rename: (id, name) =>
        withStatus(
          firstValueFrom(
            this.#http.patch<BoardSnapshotInfo>(`${base()}/${encodeURIComponent(id)}`, { name }),
          ),
        ),
      remove: (id) =>
        withStatus(firstValueFrom(this.#http.delete<void>(`${base()}/${encodeURIComponent(id)}`))),
      document: async (id) =>
        new Uint8Array(
          await withStatus(
            firstValueFrom(
              this.#http.get(`${base()}/${encodeURIComponent(id)}/document`, {
                responseType: 'arraybuffer',
              }),
            ),
          ),
        ),
    };
  }
}
