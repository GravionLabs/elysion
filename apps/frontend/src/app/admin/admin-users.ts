import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import {
  AdminApi,
  type AdminUser,
  type AdminUserDetail,
  type TransferResult,
  type UserKind,
} from './admin-api';
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

  /** People, integrations (#851) or both. */
  protected readonly kind = signal<UserKind>('all');
  protected readonly list = new PagedList<AdminUser>((query, page, size) =>
    this.#api.users(query, page, size, this.kind()),
  );
  protected readonly search = signal('');

  /** The person whose rooms and boards are open, once they are loaded; `null` when none is. */
  protected readonly detail = signal<AdminUserDetail | null>(null);
  protected readonly detailFor = signal<AdminUser | null>(null);
  protected readonly detailError = signal<string | null>(null);

  /** The question that is open over the detail: deactivate the person, or hand what they own over to somebody (#668). */
  protected readonly confirming = signal<'deactivate' | 'handover' | null>(null);
  protected readonly busy = signal(false);
  protected readonly actionError = signal<string | null>(null);

  /** The people the hand-over can go to: found by name or email, never the person who gives and never a deactivated one. */
  protected readonly receiverQuery = signal('');
  protected readonly receivers = signal<AdminUser[]>([]);
  protected readonly receiverState = signal<'idle' | 'loading' | 'done' | 'error'>('idle');
  protected readonly receiver = signal<AdminUser | null>(null);

  /** What the last hand-over moved, to say so in the dialog. */
  protected readonly transferred = signal<TransferResult | null>(null);

  /** How many boards and rooms the open person owns (directly or as creator), which a hand-over would move. */
  protected readonly owned = computed(() => {
    const person = this.detail();
    return {
      boards: person?.boards.filter((b) => b.role === 'Owner').length ?? 0,
      rooms: person?.rooms.filter((r) => r.role === 'Owner').length ?? 0,
    };
  });

  constructor() {
    inject(Title).setTitle($localize`:@@admin.users.pageTitle:Users · Administration · Elysion`);
    this.list.load();
  }

  protected submit(): void {
    this.list.search(this.search());
  }

  protected updateKind(event: Event): void {
    this.kind.set((event.target as HTMLSelectElement).value as UserKind);
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
    this.confirming.set(null);
    this.actionError.set(null);
    this.transferred.set(null);
    this.#resetReceiver();
  }

  #resetReceiver(): void {
    this.receiverQuery.set('');
    this.receivers.set([]);
    this.receiverState.set('idle');
    this.receiver.set(null);
  }

  protected askDeactivate(): void {
    this.actionError.set(null);
    this.confirming.set('deactivate');
  }

  protected cancelConfirm(): void {
    if (!this.busy()) {
      this.confirming.set(null);
    }
  }

  protected deactivate(): void {
    const person = this.detail();
    if (!person || this.busy()) return;
    this.#change(
      this.#api.deactivate(person.id),
      $localize`:@@admin.users.deactivate.error:The person could not be deactivated.`,
    );
  }

  protected reactivate(): void {
    const person = this.detail();
    if (!person || this.busy()) return;
    this.#change(
      this.#api.reactivate(person.id),
      $localize`:@@admin.users.reactivate.error:The person could not be reactivated.`,
    );
  }

  #change(call: ReturnType<AdminApi['deactivate']>, fallback: string): void {
    this.busy.set(true);
    this.actionError.set(null);
    call.subscribe({
      next: (detail) => {
        this.busy.set(false);
        this.confirming.set(null);
        this.detail.set(detail);
        this.transferred.set(null);
        // The row behind the dialog says the same as the dialog.
        this.list.items.update((items) =>
          items.map((u) =>
            u.id === detail.id ? { ...u, deactivatedAt: detail.deactivatedAt ?? null } : u,
          ),
        );
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.confirming.set(null);
        this.actionError.set(describeAdminError(error, fallback));
      },
    });
  }

  protected updateReceiverQuery(event: Event): void {
    this.receiverQuery.set((event.target as HTMLInputElement).value);
  }

  protected findReceivers(): void {
    const query = this.receiverQuery().trim();
    const giver = this.detail();
    if (query === '' || !giver) {
      this.receivers.set([]);
      this.receiverState.set('idle');
      return;
    }
    this.receiverState.set('loading');
    this.#api.users(query, 1, 8).subscribe({
      next: (answer) => {
        this.receivers.set(answer.items.filter((u) => !u.deactivatedAt && u.id !== giver.id));
        this.receiverState.set('done');
      },
      error: () => this.receiverState.set('error'),
    });
  }

  protected askHandOver(receiver: AdminUser): void {
    this.actionError.set(null);
    this.receiver.set(receiver);
    this.confirming.set('handover');
  }

  protected handOver(): void {
    const giver = this.detail();
    const receiver = this.receiver();
    if (!giver || !receiver || this.busy()) return;
    this.busy.set(true);
    this.actionError.set(null);
    this.#api.transfer(giver.id, receiver.id).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.confirming.set(null);
        this.transferred.set(result);
        this.#resetReceiver();
        // What the person owned is theirs no more: show the roles as they are now.
        this.#api.user(giver.id).subscribe({ next: (detail) => this.detail.set(detail) });
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.confirming.set(null);
        this.actionError.set(
          describeAdminError(
            error,
            $localize`:@@admin.users.handover.error:The hand-over did not work.`,
          ),
        );
      },
    });
  }

  protected deactivateLabel(person: AdminUserDetail): string {
    return $localize`:@@admin.users.deactivate.aria:Deactivate ${person.displayName}:name:`;
  }

  protected handOverLabel(user: AdminUser): string {
    return $localize`:@@admin.users.handover.to:Hand over to ${user.displayName}:name:`;
  }

  protected openLabel(user: AdminUser): string {
    return $localize`:@@admin.users.open:Show the rooms and boards of ${user.displayName}:name:`;
  }
}
