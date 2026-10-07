import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { MAX_BOARD_NAME_LENGTH } from './board-api';

/** What the user may do in a room, as the BFF names it (ADR 0019): the same three roles as on a board. */
export type RoomRole = 'Owner' | 'Editor' | 'Viewer';

/** A room as the BFF's `/api/rooms` returns it; `role` is the signed-in user's role in it. */
export interface RoomInfo {
  id: string;
  name: string;
  createdAt: string;
  role: RoomRole;
}

/** The longest room name the business backend accepts, the same as for a board. */
export const MAX_ROOM_NAME_LENGTH = MAX_BOARD_NAME_LENGTH;

/** Whether the user may put boards in the room and rename it: Editor and Owner. */
export const canWriteInRoom = (room: RoomInfo): boolean => room.role !== 'Viewer';

/** Whether the user may delete the room and manage its members: Owner. */
export const canAdministerRoom = (room: RoomInfo): boolean => room.role === 'Owner';

/**
 * Rooms group boards (ADR 0019). The BFF passes every call on to the business backend with the user's token and the
 * backend decides: a room the user has no role in is a 404, a role that is too low a 403, a bad name a 400 whose
 * `message` is worth showing.
 */
@Injectable({ providedIn: 'root' })
export class RoomApi {
  readonly #http = inject(HttpClient);

  /** The rooms the user owns or is a member of, by name. */
  list(): Observable<RoomInfo[]> {
    return this.#http.get<RoomInfo[]>('/api/rooms');
  }

  /** Creates a room with the user as its owner; the name is trimmed and checked by the backend. */
  create(name: string): Observable<RoomInfo> {
    return this.#http.post<RoomInfo>('/api/rooms', { name });
  }

  rename(id: string, name: string): Observable<RoomInfo> {
    return this.#http.patch<RoomInfo>(`/api/rooms/${encodeURIComponent(id)}`, { name });
  }

  /** Deletes a room; its boards stay and are no longer in a room. */
  delete(id: string): Observable<void> {
    return this.#http.delete<void>(`/api/rooms/${encodeURIComponent(id)}`);
  }
}
