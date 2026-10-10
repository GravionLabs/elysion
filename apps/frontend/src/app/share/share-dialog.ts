import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { Observable } from 'rxjs';
import {
  MEMBER_ROLES,
  type Member,
  MembersApi,
  type MemberRole,
  type MemberScope,
} from './members-api';

/** The message to show for a failed call: the API's own where it has one, else a general one. */
export function describeError(
  error: unknown,
  fallback: string,
  scope: MemberScope = 'board',
): string {
  if (error instanceof HttpErrorResponse) {
    const message = (error.error as { message?: unknown } | null)?.message;
    if (typeof message === 'string' && message.trim() !== '') {
      return message;
    }
    if (error.status === 403) {
      return `Only an owner of the ${scope} can do this.`;
    }
  }
  return fallback;
}

/**
 * Who may open the board and as what: the list of members with their roles, adding by email, changing a role and
 * removing a member. The API's messages (an unknown email, the creator whose role cannot change, a duplicate) are
 * shown inline, next to what caused them.
 */
@Component({
  selector: 'app-share-dialog',
  styleUrl: './share-dialog.scss',
  templateUrl: './share-dialog.html',
})
export class ShareDialog {
  readonly #api = inject(MembersApi);

  /** The id of the board, or of the room when `scope` is `room`. */
  readonly boardId = input.required<string>();
  /** What is shared: a board (the default) or a room, whose members get its role on every board in it. */
  readonly scope = input<MemberScope>('board');
  readonly closed = output<void>();

  protected readonly roles = MEMBER_ROLES;
  protected readonly members = signal<Member[]>([]);
  protected readonly loading = signal(true);
  /** Why the list could not be loaded. */
  protected readonly loadError = signal<string | null>(null);
  /** What went wrong with the last change, shown inline; cleared by the next one. */
  protected readonly error = signal<string | null>(null);
  /** Whether a change is on its way: the controls wait for it. */
  protected readonly busy = signal(false);
  protected readonly email = signal('');
  protected readonly newRole = signal<MemberRole>('Editor');

  private readonly emailField = viewChild<ElementRef<HTMLInputElement>>('emailField');

  constructor() {
    // The button that opened the dialog gets the focus back when it is gone (WCAG 2.4.3).
    const opener = document.activeElement;
    inject(DestroyRef).onDestroy(() => {
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus();
      }
    });
    effect(() => {
      this.boardId();
      untracked(() => this.load());
    });
    // Put the cursor in the email field once the dialog is there.
    effect(() => {
      const field = this.emailField()?.nativeElement;
      if (field) {
        untracked(() => field.focus());
      }
    });
  }

  protected load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.#api.list(this.boardId(), this.scope()).subscribe({
      next: (members) => {
        this.members.set(members);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.loadError.set(describeError(error, 'The members could not be loaded.', this.scope()));
      },
    });
  }

  protected updateEmail(event: Event): void {
    this.email.set((event.target as HTMLInputElement).value);
    this.error.set(null);
  }

  protected updateNewRole(event: Event): void {
    this.newRole.set((event.target as HTMLSelectElement).value as MemberRole);
  }

  protected add(): void {
    const email = this.email().trim();
    if (!email) {
      this.error.set('Enter the email of the person to add.');
      return;
    }
    this.#change(
      this.#api.add(this.boardId(), email, this.newRole(), this.scope()),
      'The member could not be added.',
      (member) => {
        this.members.update((members) => [...members, member]);
        this.email.set('');
      },
    );
  }

  protected changeRole(member: Member, event: Event): void {
    const select = event.target as HTMLSelectElement;
    const role = select.value as MemberRole;
    this.#change(
      this.#api.changeRole(this.boardId(), member.userId, role, this.scope()),
      'The role could not be changed.',
      (changed) =>
        this.members.update((members) =>
          members.map((m) => (m.userId === changed.userId ? changed : m)),
        ),
      // The select already shows the new value: put it back, the list still says the old one.
      () => (select.value = member.role),
    );
  }

  protected remove(member: Member): void {
    this.#change(
      this.#api.remove(this.boardId(), member.userId, this.scope()),
      'The member could not be removed.',
      () => this.members.update((members) => members.filter((m) => m.userId !== member.userId)),
    );
  }

  #change<T>(
    call: Observable<T>,
    failure: string,
    done: (result: T) => void,
    undo?: () => void,
  ): void {
    this.error.set(null);
    this.busy.set(true);
    call.subscribe({
      next: (result) => {
        this.busy.set(false);
        done(result);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.error.set(describeError(error, failure, this.scope()));
        undo?.();
      },
    });
  }

  protected close(): void {
    this.closed.emit();
  }

  @HostListener('document:keydown.escape')
  protected closeOnEscape(): void {
    this.close();
  }
}
