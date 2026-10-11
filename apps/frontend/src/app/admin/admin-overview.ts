import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { AUTH_SETTINGS_URL } from '../auth/auth-settings';
import { AdminApi, type AdminStats } from './admin-api';
import { describeAdminError } from './paged-list';

/** The identity provider the shell logs in with, as `auth-config.json` names it. */
export interface IdentityProviderInfo {
  authority: string;
  idpHint: string | null;
}

/** The overview of the administration (#659): four numbers and which identity provider people sign in with. */
@Component({
  selector: 'app-admin-overview',
  styleUrls: ['./admin-shared.scss', './admin-overview.scss'],
  templateUrl: './admin-overview.html',
})
export class AdminOverview {
  readonly #api = inject(AdminApi);
  readonly #http = inject(HttpClient);

  protected readonly stats = signal<AdminStats | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly provider = signal<IdentityProviderInfo | null>(null);

  constructor() {
    this.load();
    // The same file the login reads (`/auth-config.json`); a deployment may add `idpHint` (the shell's jump to the company login).
    this.#http.get<Record<string, unknown>>(AUTH_SETTINGS_URL).subscribe({
      next: (settings) => {
        const authority = settings['authority'];
        const hint = settings['idpHint'];
        this.provider.set(
          typeof authority === 'string'
            ? {
                authority,
                idpHint: typeof hint === 'string' && hint.trim() !== '' ? hint.trim() : null,
              }
            : null,
        );
      },
      error: () => this.provider.set(null),
    });
  }

  protected load(): void {
    this.error.set(null);
    this.#api.stats().subscribe({
      next: (stats) => this.stats.set(stats),
      error: (error: unknown) =>
        this.error.set(
          describeAdminError(
            error,
            $localize`:@@admin.overview.error:The numbers could not be loaded.`,
          ),
        ),
    });
  }
}
