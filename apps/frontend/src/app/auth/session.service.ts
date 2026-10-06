import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { map } from 'rxjs';

/** The signed-in user as the shell shows them. */
export interface SessionUser {
  /** The user's id at the identity provider (`sub`); the same one the backend knows. */
  id: string;
  /** What is shown: the username, else the name, else the email, else the id. */
  name: string;
  email: string | null;
  /** The cursor color other people see; the same for this user on every device. */
  color: string;
}

/** The same colors as the canvas's sticky notes and cursors (the design tokens' `--c-node-*`). */
const CURSOR_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
] as const;

/** A small stable hash (FNV-1a), to give an id the same color every time. */
function hashOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function colorFor(id: string): string {
  return CURSOR_COLORS[hashOf(id) % CURSOR_COLORS.length];
}

/** Reads the ID token's claims into a {@link SessionUser}; `null` without a usable `sub`. */
export function toSessionUser(claims: unknown): SessionUser | null {
  const data = claims as Record<string, unknown> | null | undefined;
  const text = (key: string): string | null => {
    const value = data?.[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  };
  const id = text('sub');
  if (id === null) {
    return null;
  }
  const email = text('email');
  return {
    id,
    name: text('preferred_username') ?? text('name') ?? email ?? id,
    email,
    color: colorFor(id),
  };
}

/**
 * Who is signed in, as a signal service (ADR 0009), on top of the login library: components and guards use this,
 * not the library, so the library stays replaceable in one place.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  readonly #oidc = inject(OidcSecurityService);

  /** The signed-in user, or `null` before the login is complete. */
  readonly user = toSignal(
    this.#oidc.userData$.pipe(map(({ userData }) => toSessionUser(userData))),
    {
      initialValue: null,
    },
  );
  readonly isAuthenticated = computed(() => this.user() !== null);

  /** Ends the session here and at the identity provider, then returns to the app. */
  logout(): void {
    this.#oidc.logoff().subscribe();
  }

  /** Starts the login again: the token was not accepted. */
  restartLogin(): void {
    this.#oidc.logoffLocal();
    this.#oidc.authorize();
  }
}
