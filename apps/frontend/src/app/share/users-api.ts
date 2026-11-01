import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

/** A person found by the people search: enough to recognise them and to add them as a member by id. */
export interface DirectoryUser {
  id: string;
  displayName: string;
  email: string | null;
  /** An integration (a Keycloak service account, #851), not a person: shown as "Integration" (it has no email). */
  isIntegration?: boolean;
}

/** The shortest text the backend searches for. */
export const MIN_USER_QUERY = 2;

/**
 * Finding people to share with (ADR 0027, #663): `GET /api/users?query=` answers up to ten people whose name or email contains the
 * text. Everybody who has logged in can be found by everybody who has; there is no way to list all.
 */
@Injectable({ providedIn: 'root' })
export class UsersApi {
  readonly #http = inject(HttpClient);

  search(query: string): Observable<DirectoryUser[]> {
    return this.#http.get<DirectoryUser[]>('/api/users', {
      params: new HttpParams().set('query', query),
    });
  }
}
