import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

/** What a member may do on a board, as the member API names it. */
export type MemberRole = 'Owner' | 'Editor' | 'Viewer';

export const MEMBER_ROLES: readonly MemberRole[] = ['Owner', 'Editor', 'Viewer'];

/** One person with a role on a board. */
export interface Member {
  userId: string;
  displayName: string;
  email: string | null;
  role: MemberRole;
}

/**
 * The members of a board (`/api/boards/:id/members`): only an owner may call these, and the errors carry a message the
 * dialog can show (an unknown email, the creator that cannot be changed, a duplicate).
 */
@Injectable({ providedIn: 'root' })
export class MembersApi {
  readonly #http = inject(HttpClient);

  list(boardId: string): Observable<Member[]> {
    return this.#http.get<Member[]>(this.#url(boardId));
  }

  /** Adds somebody who has logged in at least once, by email. */
  add(boardId: string, email: string, role: MemberRole): Observable<Member> {
    return this.#http.post<Member>(this.#url(boardId), { email, role });
  }

  changeRole(boardId: string, userId: string, role: MemberRole): Observable<Member> {
    return this.#http.patch<Member>(`${this.#url(boardId)}/${encodeURIComponent(userId)}`, {
      role,
    });
  }

  remove(boardId: string, userId: string): Observable<void> {
    return this.#http.delete<void>(`${this.#url(boardId)}/${encodeURIComponent(userId)}`);
  }

  #url(boardId: string): string {
    return `/api/boards/${encodeURIComponent(boardId)}/members`;
  }
}
