import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { SessionService } from '../auth/session.service';

/**
 * Where a person lands whose account an administrator deactivated (#668): every `/api` call answers 403 with the code
 * `account-deactivated`, and the interceptor sends them here instead of showing an error on every page. The page asks the API once;
 * a person whose account works is sent on to the board list, so that the address is no way to see a message that is not true.
 */
@Component({
  selector: 'app-deactivated',
  styleUrl: './deactivated.scss',
  templateUrl: './deactivated.html',
})
export class Deactivated {
  protected readonly session = inject(SessionService);
  readonly #router = inject(Router);

  /** Whether the check is done: until then the page says nothing that might be wrong. */
  protected readonly checked = signal(false);

  constructor() {
    inject(Title).setTitle($localize`:@@deactivated.pageTitle:Account deactivated · Elysion`);
    inject(HttpClient)
      .get('/api/rooms')
      .subscribe({
        next: () => void this.#router.navigateByUrl('/', { replaceUrl: true }),
        error: () => this.checked.set(true),
      });
  }
}
