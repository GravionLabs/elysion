import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { AdminApi, type AdminAccessToken } from './admin-api';
import { AdminDialog } from './admin-dialog';
import { AdminPager } from './admin-pager';
import { PagedList, describeAdminError } from './paged-list';

/**
 * Every personal access token of the instance (#851): name, start, owner, scopes and dates, never a secret; an administrator revokes
 * any of them (a leaked token, a person who left). Integrations are not here: they are users (Users, "Integrations").
 */
@Component({
  imports: [AdminDialog, AdminPager, DatePipe],
  selector: 'app-admin-tokens',
  styleUrl: './admin-shared.scss',
  templateUrl: './admin-tokens.html',
})
export class AdminTokens {
  readonly #api = inject(AdminApi);

  protected readonly list = new PagedList<AdminAccessToken>((query, page, size) =>
    this.#api.accessTokens(query, page, size),
  );
  protected readonly search = signal('');

  protected readonly revoking = signal<AdminAccessToken | null>(null);
  protected readonly busy = signal(false);
  protected readonly actionError = signal<string | null>(null);

  /** The clock the list compares expiries with; a field so tests can set it. */
  protected now = () => Date.now();

  constructor() {
    inject(Title).setTitle(
      $localize`:@@admin.tokens.pageTitle:Access tokens · Administration · Elysion`,
    );
    this.list.load();
  }

  protected submit(): void {
    this.list.search(this.search());
  }

  protected updateSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected isExpired(token: AdminAccessToken): boolean {
    return Date.parse(token.expiresAt) <= this.now();
  }

  protected askRevoke(token: AdminAccessToken): void {
    this.actionError.set(null);
    this.revoking.set(token);
  }

  protected cancelRevoke(): void {
    if (!this.busy()) this.revoking.set(null);
  }

  protected revoke(): void {
    const token = this.revoking();
    if (!token || this.busy()) return;
    this.busy.set(true);
    this.#api.revokeAccessToken(token.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.revoking.set(null);
        const at = new Date(this.now()).toISOString();
        this.list.items.update((items) =>
          items.map((t) => (t.id === token.id ? { ...t, revokedAt: t.revokedAt ?? at } : t)),
        );
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.revoking.set(null);
        this.actionError.set(
          describeAdminError(
            error,
            $localize`:@@admin.tokens.revoke.error:The token could not be revoked.`,
          ),
        );
      },
    });
  }

  protected revokeLabel(token: AdminAccessToken): string {
    return $localize`:@@admin.tokens.revoke.aria:Revoke ${token.name}:name: of ${token.owner.displayName}:owner:`;
  }
}
