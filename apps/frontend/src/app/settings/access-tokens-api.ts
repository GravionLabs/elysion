import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

/** The scopes of the public API (ADR 0033), in the order the page lists them. */
export const API_SCOPES = [
  'boards:read',
  'boards:write',
  'members:write',
  'snapshots:write',
  'webhooks:write',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

/** How long a new token may be good for, in days: the backend allows 1 to 365. */
export const EXPIRY_CHOICES = [7, 30, 90, 365] as const;

/** The longest name of a token. */
export const MAX_TOKEN_NAME_LENGTH = 100;

/** A personal access token in its owner's list (#851): never the secret. `prefix` is its start, to recognise it. */
export interface AccessTokenItem {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
}

/** The answer to making a token: the one time `token`, the secret, is shown. */
export interface CreatedAccessToken extends AccessTokenItem {
  token: string;
}

export interface NewAccessToken {
  name: string;
  scopes: string[];
  expiresInDays: number;
}

/**
 * The person's personal access tokens (`/api/access-tokens`, ADR 0033, #851): list, make, revoke. Only the person themselves, signed
 * in, can do any of it; a token cannot manage tokens.
 */
@Injectable({ providedIn: 'root' })
export class AccessTokensApi {
  readonly #http = inject(HttpClient);

  list(): Observable<AccessTokenItem[]> {
    return this.#http.get<AccessTokenItem[]>('/api/access-tokens');
  }

  create(token: NewAccessToken): Observable<CreatedAccessToken> {
    return this.#http.post<CreatedAccessToken>('/api/access-tokens', token);
  }

  revoke(id: string): Observable<void> {
    return this.#http.delete<void>(`/api/access-tokens/${encodeURIComponent(id)}`);
  }
}
