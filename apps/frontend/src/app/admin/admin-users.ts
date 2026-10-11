import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { AdminApi, type AdminUser, type AdminUserDetail } from './admin-api';
import { AdminDialog } from './admin-dialog';
import { AdminPager } from './admin-pager';
import { PagedList, describeAdminError } from './paged-list';

/** The people of the instance (#659): searchable, paged, with the groups each one is in; a row opens their rooms and boards. */
@Component({
  imports: [AdminDialog, AdminPager, DatePipe],
  selector: 'app-admin-users',
  styleUrl: './admin-shared.scss',
  templateUrl: './admin-users.html',
})
export class AdminUsers {
  readonly #api = inject(AdminApi);

  protected readonly list = new PagedList<AdminUser>((query, page, size) =>
    this.#api.users(query, page, size),
  );
  protected readonly search = signal('');

  /** The person whose rooms and boards are open, once they are loaded; `null` when none is. */
  protected readonly detail = signal<AdminUserDetail | null>(null);
  protected readonly detailFor = signal<AdminUser | null>(null);
  protected readonly detailError = signal<string | null>(null);

  constructor() {
    inject(Title).setTitle($localize`:@@admin.users.pageTitle:Users · Administration · Elysion`);
    this.list.load();
  }

  protected submit(): void {
    this.list.search(this.search());
  }

  protected updateSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected open(user: AdminUser): void {
    this.detailFor.set(user);
    this.detail.set(null);
    this.detailError.set(null);
    this.#api.user(user.id).subscribe({
      next: (detail) => this.detail.set(detail),
      error: (error: unknown) =>
        this.detailError.set(
          describeAdminError(
            error,
            $localize`:@@admin.users.detail.error:The details could not be loaded.`,
          ),
        ),
    });
  }

  protected close(): void {
    this.detailFor.set(null);
    this.detail.set(null);
  }

  protected openLabel(user: AdminUser): string {
    return $localize`:@@admin.users.open:Show the rooms and boards of ${user.displayName}:name:`;
  }
}
