import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type { AuditEntry } from '../audit/audit';
import type { MemberScope } from './members-api';

/** The last entries of the audit log about a board or a room (`/api/boards|rooms/:id/history`), for the people who own it. */
@Injectable({ providedIn: 'root' })
export class HistoryApi {
  readonly #http = inject(HttpClient);

  list(id: string, scope: MemberScope): Observable<AuditEntry[]> {
    const kind = scope === 'room' ? 'rooms' : 'boards';
    return this.#http.get<AuditEntry[]>(`/api/${kind}/${encodeURIComponent(id)}/history`);
  }
}
