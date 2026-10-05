import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, of } from 'rxjs';

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

@Injectable({ providedIn: 'root' })
export class BoardApi {
  readonly #http = inject(HttpClient);

  /**
   * The board with this id, or `null` when it has no record: a room such as `default` is not a stored
   * board, an unknown id is a 404 and a failing BFF is not worth breaking the page for. Ids that cannot
   * be board ids are not even asked for.
   */
  get(id: string): Observable<BoardInfo | null> {
    if (!UUID.test(id)) {
      return of(null);
    }
    return this.#http
      .get<BoardInfo>(`/api/boards/${encodeURIComponent(id)}`)
      .pipe(catchError(() => of(null)));
  }

  /** All boards, newest first. Fails when the BFF does: the list page has an error state for that. */
  list(): Observable<BoardInfo[]> {
    return this.#http.get<BoardInfo[]>('/api/boards');
  }

  /** Creates a board; the name is trimmed and checked by the backend (1 to 120 characters). */
  create(name: string): Observable<BoardInfo> {
    return this.#http.post<BoardInfo>('/api/boards', { name });
  }
}
