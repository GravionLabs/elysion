import { HttpClient } from '@angular/common/http';
import { Injectable, Injector, inject, signal } from '@angular/core';

/** What `GET /api/auth/me` says about the signed-in person. */
interface Me {
  id: string;
  email?: string | null;
  isAdministrator: boolean;
}

/**
 * What the shell knows about the signed-in person beyond their token's claims: whether they administer the instance
 * (ADR 0027, #659). It is a hint for the interface (the menu entry, the admin pages); the business backend checks the role on
 * every admin call. Loaded once per page load, by the app root as soon as somebody is signed in, and by the admin pages
 * if they are opened first.
 */
@Injectable({ providedIn: 'root' })
export class Account {
  // Looked up when it is needed, so that a test of a component that only reads the flag needs no HTTP client.
  readonly #injector = inject(Injector);
  #started = false;

  /** Whether the person administers the instance; `null` until the answer is in, `false` when it failed. */
  readonly isAdministrator = signal<boolean | null>(null);

  load(): void {
    if (this.#started) {
      return;
    }
    this.#started = true;
    this.#injector
      .get(HttpClient)
      .get<Me>('/api/auth/me')
      .subscribe({
        next: (me) => this.isAdministrator.set(me.isAdministrator === true),
        error: () => this.isAdministrator.set(false),
      });
  }
}
