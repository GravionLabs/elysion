import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { MemberScope } from './members-api';

/** The roles a link can give: an owner is never made by a link. */
export type InvitationRole = 'Editor' | 'Viewer';

/** An active link as the list shows it: the token is only ever known right after the link was made. */
export interface Invitation {
  id: string;
  role: InvitationRole;
  expiresAt: string;
  /** `null` for a link that can be used as often as it likes until it expires. */
  maxUses: number | null;
  uses: number;
  createdAt: string;
}

/** The answer to making a link: the only time the token is in a response. */
export interface CreatedInvitation extends Invitation {
  token: string;
}

export interface InvitationRequest {
  role: InvitationRole;
  /** 1 to 720 (30 days). */
  expiresInHours: number;
  /** 1 to 1000, or left out. */
  maxUses?: number;
}

/** What a link led to: the board or the room the person is a member of now, and the role they have there. */
export interface AcceptedInvitation {
  kind: 'board' | 'room';
  id: string;
  role: string;
}

/** The invitation links of a board or a room, and the call that uses one (`/api/invitations/:token/accept`). */
@Injectable({ providedIn: 'root' })
export class InvitationsApi {
  readonly #http = inject(HttpClient);

  list(id: string, scope: MemberScope): Observable<Invitation[]> {
    return this.#http.get<Invitation[]>(this.#url(scope, id));
  }

  create(
    id: string,
    scope: MemberScope,
    request: InvitationRequest,
  ): Observable<CreatedInvitation> {
    return this.#http.post<CreatedInvitation>(this.#url(scope, id), request);
  }

  revoke(id: string, scope: MemberScope, invitationId: string): Observable<void> {
    return this.#http.delete<void>(`${this.#url(scope, id)}/${encodeURIComponent(invitationId)}`);
  }

  accept(token: string): Observable<AcceptedInvitation> {
    return this.#http.post<AcceptedInvitation>(
      `/api/invitations/${encodeURIComponent(token)}/accept`,
      null,
    );
  }

  #url(scope: MemberScope, id: string): string {
    return `/api/${scope === 'room' ? 'rooms' : 'boards'}/${encodeURIComponent(id)}/invitations`;
  }
}

/** The address a person opens to use the link. */
export function inviteUrl(origin: string, token: string): string {
  return `${origin}/invite/${encodeURIComponent(token)}`;
}
