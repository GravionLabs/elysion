import {
  Component,
  DestroyRef,
  HostListener,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { Observable } from 'rxjs';
import { describeError } from './error-message';
import { ShareHistory } from './history';
import { InviteLinks } from './invite-links';
import { RoomAccess } from './room-access';
import { RoomGroups } from './room-groups';
import { Typeahead, type TypeaheadOption } from './typeahead';
import { type DirectoryUser, UsersApi } from './users-api';
import {
  MEMBER_ROLES,
  type Member,
  MembersApi,
  type MemberRole,
  type MemberScope,
} from './members-api';

export { describeError };

/**
 * Who may open the board and as what: the list of members with their roles, adding a person found by name or email (or by a
 * full email address), changing a role and removing a member. A room's dialog also has the room's groups, a board's dialog in a
 * room says who else has access through it. The API's messages (an unknown email, the creator whose role cannot change, a duplicate) are
 * shown inline, next to what caused them.
 */
@Component({
  imports: [InviteLinks, RoomAccess, RoomGroups, ShareHistory, Typeahead],
  selector: 'app-share-dialog',
  styleUrl: './share-dialog.scss',
  templateUrl: './share-dialog.html',
})
export class ShareDialog {
  readonly #api = inject(MembersApi);
  readonly #users = inject(UsersApi);

  /** The id of the board, or of the room when `scope` is `room`. */
  readonly boardId = input.required<string>();
  /** What is shared: a board (the default) or a room, whose members get its role on every board in it. */
  readonly scope = input<MemberScope>('board');
  /** For a board: the room it is in, whose people and groups also have access (shown, not changed here). */
  readonly roomId = input<string | null>(null);
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
  /** What the person field holds: a name being searched, or an email address. */
  protected readonly email = signal('');
  protected readonly newRole = signal<MemberRole>('Editor');
  protected readonly found = signal<DirectoryUser[]>([]);
  protected readonly searching = signal(false);
  /** The person chosen from the list; typing again takes the choice back. */
  protected readonly picked = signal<DirectoryUser | null>(null);
  protected readonly options = computed<TypeaheadOption[]>(() =>
    this.found()
      // Somebody who has a role already is changed in the list, not added again.
      .filter((user) => !this.members().some((m) => m.userId === user.id))
      .map((user) => ({ id: user.id, label: user.displayName, detail: user.email })),
  );
  #searchNo = 0;

  private readonly personField = viewChild(Typeahead);

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
    // Put the cursor in the person field once the dialog is there.
    effect(() => {
      const field = this.personField();
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
        this.loadError.set(
          describeError(
            error,
            $localize`:@@share.error.loadFailed:The members could not be loaded.`,
            this.scope(),
          ),
        );
      },
    });
  }

  protected typed(text: string): void {
    this.email.set(text);
    this.error.set(null);
  }

  /** The person stopped typing: look for people with that name or email (an empty text clears the list). */
  protected searchPeople(text: string): void {
    this.picked.set(null);
    this.error.set(null);
    const no = ++this.#searchNo;
    if (text === '') {
      this.found.set([]);
      this.searching.set(false);
      return;
    }
    this.searching.set(true);
    this.#users.search(text).subscribe({
      next: (users) => {
        if (no === this.#searchNo) {
          this.found.set(users);
          this.searching.set(false);
        }
      },
      error: () => {
        // A search that fails leaves the field as it is: a full email address can still be added.
        if (no === this.#searchNo) {
          this.found.set([]);
          this.searching.set(false);
        }
      },
    });
  }

  protected pickPerson(option: TypeaheadOption): void {
    this.picked.set(this.found().find((user) => user.id === option.id) ?? null);
    this.error.set(null);
  }

  protected updateNewRole(event: Event): void {
    this.newRole.set((event.target as HTMLSelectElement).value as MemberRole);
  }

  protected add(): void {
    const text = this.email().trim();
    const person = this.picked();
    let who: { userId: string } | { email: string };
    if (person && text === person.displayName) {
      who = { userId: person.id };
    } else if (text.includes('@')) {
      who = { email: text };
    } else if (text === '') {
      this.error.set(
        $localize`:@@share.error.personRequired:Search for a person by name or email, or enter an email address.`,
      );
      return;
    } else {
      this.error.set(
        $localize`:@@share.error.pickPerson:Choose a person from the list, or enter a full email address.`,
      );
      return;
    }
    this.#change(
      this.#api.add(this.boardId(), who, this.newRole(), this.scope()),
      $localize`:@@share.error.addFailed:The member could not be added.`,
      (member) => {
        this.members.update((members) => [...members, member]);
        this.email.set('');
        this.picked.set(null);
        this.found.set([]);
      },
    );
  }

  protected changeRole(member: Member, event: Event): void {
    const select = event.target as HTMLSelectElement;
    const role = select.value as MemberRole;
    this.#change(
      this.#api.changeRole(this.boardId(), member.userId, role, this.scope()),
      $localize`:@@share.error.roleFailed:The role could not be changed.`,
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
      $localize`:@@share.error.removeFailed:The member could not be removed.`,
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

  /** The role as shown; the value stays the API's. */
  protected roleLabel(role: MemberRole): string {
    switch (role) {
      case 'Owner':
        return $localize`:@@share.role.owner:Owner`;
      case 'Editor':
        return $localize`:@@share.role.editor:Editor`;
      case 'Viewer':
        return $localize`:@@share.role.viewer:Viewer`;
      default:
        return role;
    }
  }

  protected removeLabel(member: Member): string {
    return $localize`:@@share.remove.label:Remove ${member.displayName}:name:`;
  }

  protected roleOfLabel(member: Member): string {
    return $localize`:@@share.roleOf.label:Role of ${member.displayName}:name:`;
  }

  protected close(): void {
    this.closed.emit();
  }

  @HostListener('document:keydown.escape')
  protected closeOnEscape(): void {
    this.close();
  }
}
