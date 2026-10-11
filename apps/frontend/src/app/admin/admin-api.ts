import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

/** A page of a list of the admin API: `?page=` from 1, `?pageSize=` up to 100. */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminStats {
  users: number;
  usersSeenLast30Days: number;
  groups: number;
  rooms: number;
  boards: number;
}

export interface GroupRef {
  id: string;
  name: string;
}

export interface AdminUser {
  id: string;
  displayName: string;
  email: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  groups: GroupRef[];
}

/** A room or a board the person has a role on directly: names and roles, never content. */
export interface RoleOn {
  id: string;
  name: string;
  role: string;
}

export interface AdminUserDetail extends AdminUser {
  rooms: RoleOn[];
  boards: RoleOn[];
}

export type GroupSource = 'Local' | 'IdentityProvider';

export interface AdminGroup {
  id: string;
  name: string;
  source: GroupSource;
  externalId: string | null;
  memberCount: number;
  roomCount: number;
}

export interface GroupMember {
  id: string;
  displayName: string;
  email: string | null;
}

export interface AdminRoom {
  id: string;
  name: string;
  owner: { id: string; displayName: string } | null;
  memberCount: number;
  groupCount: number;
  boardCount: number;
  createdAt: string;
}

/** What may change on a group: a name, and the external id that links it (`null` unlinks it). */
export interface GroupChange {
  name?: string;
  externalId?: string | null;
}

/** The longest text the admin lists search by. */
export const MAX_QUERY_LENGTH = 100;
/** The longest name the API accepts for a group. */
export const MAX_GROUP_NAME_LENGTH = 120;
/** The longest external id of a group. */
export const MAX_EXTERNAL_ID_LENGTH = 255;

/**
 * The administration area of the BFF (`/api/admin/*`, ADR 0027): people, groups and rooms as metadata, never what is on a board. The
 * business backend answers 403 to everybody who is not an administrator; the shell only avoids offering the pages to them.
 */
@Injectable({ providedIn: 'root' })
export class AdminApi {
  readonly #http = inject(HttpClient);

  stats(): Observable<AdminStats> {
    return this.#http.get<AdminStats>('/api/admin/stats');
  }

  users(query: string, page: number, pageSize: number): Observable<Page<AdminUser>> {
    return this.#http.get<Page<AdminUser>>('/api/admin/users', {
      params: this.#params(query, page, pageSize),
    });
  }

  user(id: string): Observable<AdminUserDetail> {
    return this.#http.get<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(id)}`);
  }

  groups(query: string, page: number, pageSize: number): Observable<Page<AdminGroup>> {
    return this.#http.get<Page<AdminGroup>>('/api/admin/groups', {
      params: this.#params(query, page, pageSize),
    });
  }

  createGroup(name: string): Observable<AdminGroup> {
    return this.#http.post<AdminGroup>('/api/admin/groups', { name });
  }

  changeGroup(id: string, change: GroupChange): Observable<AdminGroup> {
    return this.#http.patch<AdminGroup>(`/api/admin/groups/${encodeURIComponent(id)}`, change);
  }

  deleteGroup(id: string): Observable<void> {
    return this.#http.delete<void>(`/api/admin/groups/${encodeURIComponent(id)}`);
  }

  members(id: string, page: number, pageSize: number): Observable<Page<GroupMember>> {
    return this.#http.get<Page<GroupMember>>(
      `/api/admin/groups/${encodeURIComponent(id)}/members`,
      { params: this.#params('', page, pageSize) },
    );
  }

  addMember(groupId: string, userId: string): Observable<void> {
    return this.#http.put<void>(
      `/api/admin/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`,
      null,
    );
  }

  removeMember(groupId: string, userId: string): Observable<void> {
    return this.#http.delete<void>(
      `/api/admin/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`,
    );
  }

  rooms(query: string, page: number, pageSize: number): Observable<Page<AdminRoom>> {
    return this.#http.get<Page<AdminRoom>>('/api/admin/rooms', {
      params: this.#params(query, page, pageSize),
    });
  }

  #params(query: string, page: number, pageSize: number): HttpParams {
    let params = new HttpParams().set('page', page).set('pageSize', pageSize);
    const text = query.trim().slice(0, MAX_QUERY_LENGTH);
    if (text !== '') {
      params = params.set('query', text);
    }
    return params;
  }
}
