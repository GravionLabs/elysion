import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/**
 * What the canvas calls to keep the bytes of a board's images (`fileStore` of `<elysion-canvas>`, #702): `put`
 * uploads one under the id Excalidraw gave it, `get` loads one. A failed `put` rejects with a message that is shown to
 * the user as it is.
 */
export interface BoardFileStore {
  put(file: Blob, id: string): Promise<void>;
  get(id: string): Promise<Blob>;
}

/** The message for a refused upload: the backend's rules, in words (the type and size limits are its, see docs/specs/business-backend.md). */
export function uploadErrorMessage(error: unknown): string {
  switch (error instanceof HttpErrorResponse ? error.status : 0) {
    case 400:
    case 415:
      return 'Only PNG, JPEG, GIF and WebP images can be added.';
    case 403:
      return 'You can only look at this board, not add images.';
    case 409:
      return 'This board holds as many images as it can. Delete some to add more.';
    case 413:
      return 'The image is too large.';
    default:
      return 'The image could not be saved.';
  }
}

@Injectable({ providedIn: 'root' })
export class FilesApi {
  readonly #http = inject(HttpClient);

  /** The images of one board, as the canvas wants them. `boardId` is read at every call, so it follows the page. */
  storeFor(boardId: () => string): BoardFileStore {
    return {
      put: async (file, id) => {
        try {
          await firstValueFrom(
            this.#http.put<void>(this.#url(boardId(), id), file, {
              headers: { 'Content-Type': file.type },
            }),
          );
        } catch (error) {
          throw new Error(uploadErrorMessage(error), { cause: error });
        }
      },
      get: (id) =>
        firstValueFrom(this.#http.get(this.#url(boardId(), id), { responseType: 'blob' })),
    };
  }

  #url(boardId: string, fileId: string): string {
    return `/api/boards/${encodeURIComponent(boardId)}/files/${encodeURIComponent(fileId)}`;
  }
}
