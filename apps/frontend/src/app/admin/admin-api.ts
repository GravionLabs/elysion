import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type { AuditEntry } from '../audit/audit';

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
  /** When an administrator deactivated the person (#668), or `null`/absent. */
  deactivatedAt?: string | null;
  /** An integration (a Keycloak service account, #851), not a person. */
  isIntegration?: boolean;
}

/** Which users a list shows: everybody, people only or integrations only (#851). */
export type UserKind = 'all' | 'person' | 'integration';

/** A personal access token of somebody (#851): its name, start, scopes, owner and dates; never the secret. */
export interface AdminAccessToken {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  owner: { id: string; displayName: string };
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
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
  /** People the directory lists in a linked group who have not signed in yet (Microsoft Graph sync, #667). */
  pendingCount?: number;
  /** When the Graph sync last read the group, or `null`/absent. */
  lastSyncAt?: string | null;
}

/** A person the directory lists who has not signed in yet. */
export interface PendingMember {
  email: string;
  displayName: string | null;
}

/** Whether the Graph sync runs, how often, when it last read a group and how many people wait for their first sign-in. */
export interface GraphStatus {
  enabled: boolean;
  intervalMinutes: number;
  lastSyncAt: string | null;
  pendingMembers: number;
}

export interface GroupMember {
  id: string;
  displayName: string;
  email: string | null;
  deactivatedAt?: string | null;
}

/** How many boards and rooms changed owner in a hand-over (#668). */
export interface TransferResult {
  boards: number;
  rooms: number;
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

/** What the audit log is filtered by: what it is about, who did it, and a time span (dates as `YYYY-MM-DD`). */
export interface AuditFilter {
  subject?: string;
  actor?: string;
  from?: string;
  to?: string;
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

  users(
    query: string,
    page: number,
    pageSize: number,
    kind: UserKind = 'all',
  ): Observable<Page<AdminUser>> {
    const params = this.#params(query, page, pageSize);
    return this.#http.get<Page<AdminUser>>('/api/admin/users', {
      params: kind === 'all' ? params : params.set('kind', kind),
    });
  }

  /** Every personal access token of the instance (#851), newest first, searched by name, start or owner. */
  accessTokens(query: string, page: number, pageSize: number): Observable<Page<AdminAccessToken>> {
    return this.#http.get<Page<AdminAccessToken>>('/api/admin/access-tokens', {
      params: this.#params(query, page, pageSize),
    });
  }

  /** Revokes anybody's token: scripts that use it are refused within half a minute. */
  revokeAccessToken(id: string): Observable<void> {
    return this.#http.delete<void>(`/api/admin/access-tokens/${encodeURIComponent(id)}`);
  }

  user(id: string): Observable<AdminUserDetail> {
    return this.#http.get<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(id)}`);
  }

  /** Deactivates a person (#668): every request of theirs is refused from now on. Answers their detail. */
  deactivate(id: string): Observable<AdminUserDetail> {
    return this.#http.post<AdminUserDetail>(
      `/api/admin/users/${encodeURIComponent(id)}/deactivate`,
      null,
    );
  }

  reactivate(id: string): Observable<AdminUserDetail> {
    return this.#http.post<AdminUserDetail>(
      `/api/admin/users/${encodeURIComponent(id)}/reactivate`,
      null,
    );
  }

  /** Makes `toUserId` the owner of the boards and rooms the deactivated person `fromUserId` owned (#668). */
  transfer(fromUserId: string, toUserId: string): Observable<TransferResult> {
    return this.#http.post<TransferResult>('/api/admin/boards/transfer', { fromUserId, toUserId });
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

  pending(id: string, page: number, pageSize: number): Observable<Page<PendingMember>> {
    return this.#http.get<Page<PendingMember>>(
      `/api/admin/groups/${encodeURIComponent(id)}/pending`,
      { params: this.#params('', page, pageSize) },
    );
  }

  graphStatus(): Observable<GraphStatus> {
    return this.#http.get<GraphStatus>('/api/admin/graph');
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

  audit(filter: AuditFilter, page: number, pageSize: number): Observable<Page<AuditEntry>> {
    let params = new HttpParams().set('page', page).set('pageSize', pageSize);
    for (const [key, value] of Object.entries(filter)) {
      if (value) {
        params = params.set(key, value);
      }
    }
    return this.#http.get<Page<AuditEntry>>('/api/admin/audit', { params });
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
