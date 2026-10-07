import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

/** What a member may do on a board, as the member API names it. */
export type MemberRole = 'Owner' | 'Editor' | 'Viewer';

export const MEMBER_ROLES: readonly MemberRole[] = ['Owner', 'Editor', 'Viewer'];

/** What the members belong to: a board, or a room (ADR 0019), whose member API has the same shape. */
export type MemberScope = 'board' | 'room';

/** One person with a role on a board or in a room. */
export interface Member {
  userId: string;
  displayName: string;
  email: string | null;
  role: MemberRole;
}

/**
 * The members of a board (`/api/boards/:id/members`) or of a room (`/api/rooms/:id/members`): only an owner may call these, and the errors carry a message the
 * dialog can show (an unknown email, the creator that cannot be changed, a duplicate).
 */
@Injectable({ providedIn: 'root' })
export class MembersApi {
  readonly #http = inject(HttpClient);

  list(id: string, scope: MemberScope = 'board'): Observable<Member[]> {
    return this.#http.get<Member[]>(this.#url(scope, id));
  }

  /** Adds somebody who has logged in at least once, by email. */
  add(
    id: string,
    email: string,
    role: MemberRole,
    scope: MemberScope = 'board',
  ): Observable<Member> {
    return this.#http.post<Member>(this.#url(scope, id), { email, role });
  }

  changeRole(
    id: string,
    userId: string,
    role: MemberRole,
    scope: MemberScope = 'board',
  ): Observable<Member> {
    return this.#http.patch<Member>(`${this.#url(scope, id)}/${encodeURIComponent(userId)}`, {
      role,
    });
  }

  remove(id: string, userId: string, scope: MemberScope = 'board'): Observable<void> {
    return this.#http.delete<void>(`${this.#url(scope, id)}/${encodeURIComponent(userId)}`);
  }

  #url(scope: MemberScope, id: string): string {
    return `/api/${scope === 'room' ? 'rooms' : 'boards'}/${encodeURIComponent(id)}/members`;
  }
}
