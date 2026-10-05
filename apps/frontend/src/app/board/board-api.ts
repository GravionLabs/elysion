import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';

/** A board as the BFF's `/api/boards` returns it. */
export interface BoardInfo {
  id: string;
  name: string;
  createdAt: string;
  /** The route that opens the board. */
  path: string;
}

/** The longest name the business backend accepts. */
export const MAX_BOARD_NAME_LENGTH = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether an id can be a stored board's; other ids (such as `default`) are rooms without a record. */
export function isStoredBoardId(id: string): boolean {
  return UUID.test(id);
}

/** What the BFF knows about the id of a board page. */
export type BoardLookup =
  | { status: 'found'; board: BoardInfo }
  /** A stored board id for which there is no board: it never existed or it was deleted. */
  | { status: 'missing' }
  /** Not a stored board's id, so no record is expected (the room `default`). */
  | { status: 'room' }
  /** The BFF failed: carry on without a name rather than break the page. */
  | { status: 'unavailable' };

@Injectable({ providedIn: 'root' })
export class BoardApi {
  readonly #http = inject(HttpClient);

  /** What is known about this id: the board, that there is none, or that it is not a board id at all. */
  find(id: string): Observable<BoardLookup> {
    if (!isStoredBoardId(id)) {
      return of<BoardLookup>({ status: 'room' });
    }
    return this.#http.get<BoardInfo>(`/api/boards/${encodeURIComponent(id)}`).pipe(
      map((board): BoardLookup => ({ status: 'found', board })),
      catchError((error: unknown) =>
        of<BoardLookup>(
          error instanceof HttpErrorResponse && error.status === 404
            ? { status: 'missing' }
            : { status: 'unavailable' },
        ),
      ),
    );
  }

  /**
   * The board with this id, or `null` when it has no record: a room such as `default` is not a stored
   * board, an unknown id is a 404 and a failing BFF is not worth breaking the page for.
   */
  get(id: string): Observable<BoardInfo | null> {
    return this.find(id).pipe(map((lookup) => (lookup.status === 'found' ? lookup.board : null)));
  }

  /** All boards, newest first. Fails when the BFF does: the list page has an error state for that. */
  list(): Observable<BoardInfo[]> {
    return this.#http.get<BoardInfo[]>('/api/boards');
  }

  /** Creates a board; the name is trimmed and checked by the backend (1 to 120 characters). */
  create(name: string): Observable<BoardInfo> {
    return this.#http.post<BoardInfo>('/api/boards', { name });
  }

  /** Renames a board; the backend trims the name and checks it (1 to 120 characters). */
  rename(id: string, name: string): Observable<BoardInfo> {
    return this.#http.patch<BoardInfo>(`/api/boards/${encodeURIComponent(id)}`, { name });
  }

  /** A new board named "<name> (copy)" with a copy of the board's stored content. */
  duplicate(id: string): Observable<BoardInfo> {
    return this.#http.post<BoardInfo>(`/api/boards/${encodeURIComponent(id)}/duplicate`, null);
  }

  /** Deletes a board and, in the business backend, its stored content. */
  delete(id: string): Observable<void> {
    return this.#http.delete<void>(`/api/boards/${encodeURIComponent(id)}`);
  }
}
