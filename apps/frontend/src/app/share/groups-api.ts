import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { MemberRole } from './members-api';

/** A group as the BFF returns it (ADR 0027): no members; `Local` ones are made in Elysion, `IdentityProvider` ones are owned by the sign-in provider. */
export interface GroupInfo {
  id: string;
  name: string;
  source: 'Local' | 'IdentityProvider';
}

/** A group's role in a room. */
export interface RoomGroup {
  groupId: string;
  name: string;
  role: MemberRole;
}

/** The shortest text the backend searches groups for. */
export const MIN_GROUP_QUERY = 2;

/** Groups and their roles in a room: everybody who sees the room lists them, only its owners change them. */
@Injectable({ providedIn: 'root' })
export class GroupsApi {
  readonly #http = inject(HttpClient);

  search(query: string): Observable<GroupInfo[]> {
    return this.#http.get<GroupInfo[]>('/api/groups', {
      params: new HttpParams().set('query', query),
    });
  }

  listForRoom(roomId: string): Observable<RoomGroup[]> {
    return this.#http.get<RoomGroup[]>(this.#url(roomId));
  }

  /** Gives the group a role in the room, or changes it. */
  setRole(roomId: string, groupId: string, role: MemberRole): Observable<RoomGroup> {
    return this.#http.put<RoomGroup>(`${this.#url(roomId)}/${encodeURIComponent(groupId)}`, {
      role,
    });
  }

  remove(roomId: string, groupId: string): Observable<void> {
    return this.#http.delete<void>(`${this.#url(roomId)}/${encodeURIComponent(groupId)}`);
  }

  #url(roomId: string): string {
    return `/api/rooms/${encodeURIComponent(roomId)}/groups`;
  }
}
