import { Component, computed, inject, input, signal } from '@angular/core';
import type { Observable } from 'rxjs';
import { GroupsApi, type GroupInfo, type RoomGroup } from './groups-api';
import { MEMBER_ROLES, type MemberRole } from './members-api';
import { describeError } from './error-message';
import { Typeahead, type TypeaheadOption } from './typeahead';

/** How a group is labeled in the search results and the list: where its members come from. */
export function groupSourceLabel(source: GroupInfo['source']): string {
  return source === 'IdentityProvider'
    ? $localize`:@@share.groups.source.provider:from Microsoft Entra ID`
    : $localize`:@@share.groups.source.local:local`;
}

/**
 * The groups that have a role in a room (ADR 0027, #652), under the people of the Share dialog: a search for a group by name, a
 * role, Add; the list with a role select and Remove each. An owner changes them; with `readOnly` the list is only shown (the API
 * enforces the same: a lower role gets a 403). The backend's messages (an unknown group, 403) are shown, not swallowed.
 */
@Component({
  imports: [Typeahead],
  selector: 'app-room-groups',
  styleUrl: './room-groups.scss',
  templateUrl: './room-groups.html',
})
export class RoomGroups {
  readonly #api = inject(GroupsApi);

  readonly roomId = input.required<string>();
  readonly readOnly = input(false);

  protected readonly roles = MEMBER_ROLES;
  protected readonly groups = signal<RoomGroup[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly text = signal('');
  protected readonly found = signal<GroupInfo[]>([]);
  protected readonly searching = signal(false);
  protected readonly picked = signal<GroupInfo | null>(null);
  protected readonly newRole = signal<MemberRole>('Viewer');
  #searchNo = 0;

  protected readonly options = computed<TypeaheadOption[]>(() =>
    this.found()
      // A group that has a role already is changed in the list, not added again.
      .filter((group) => !this.groups().some((g) => g.groupId === group.id))
      .map((group) => ({
        id: group.id,
        label: group.name,
        detail: groupSourceLabel(group.source),
      })),
  );

  constructor() {
    queueMicrotask(() => this.load());
  }

  protected load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.#api.listForRoom(this.roomId()).subscribe({
      next: (groups) => {
        this.groups.set(groups);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.loadError.set(
          describeError(
            error,
            $localize`:@@share.groups.error.load:The groups could not be loaded.`,
            'room',
          ),
        );
      },
    });
  }

  protected typed(text: string): void {
    this.text.set(text);
    this.error.set(null);
  }

  protected search(text: string): void {
    this.picked.set(null);
    const no = ++this.#searchNo;
    if (text === '') {
      this.found.set([]);
      this.searching.set(false);
      return;
    }
    this.searching.set(true);
    this.#api.search(text).subscribe({
      next: (groups) => {
        if (no === this.#searchNo) {
          this.found.set(groups);
          this.searching.set(false);
        }
      },
      error: (error: unknown) => {
        if (no === this.#searchNo) {
          this.found.set([]);
          this.searching.set(false);
          this.error.set(
            describeError(
              error,
              $localize`:@@share.groups.error.search:The groups could not be searched.`,
              'room',
            ),
          );
        }
      },
    });
  }

  protected pick(option: TypeaheadOption): void {
    this.picked.set(this.found().find((group) => group.id === option.id) ?? null);
    this.error.set(null);
  }

  protected updateNewRole(event: Event): void {
    this.newRole.set((event.target as HTMLSelectElement).value as MemberRole);
  }

  protected add(): void {
    const group = this.picked();
    if (!group || this.text().trim() !== group.name) {
      this.error.set(
        $localize`:@@share.groups.error.pick:Search for a group and choose one from the list.`,
      );
      return;
    }
    this.#change(
      this.#api.setRole(this.roomId(), group.id, this.newRole()),
      $localize`:@@share.groups.error.add:The group could not be added.`,
      (added) => {
        this.groups.update((groups) => [...groups, added]);
        this.text.set('');
        this.picked.set(null);
        this.found.set([]);
      },
    );
  }

  protected changeRole(group: RoomGroup, event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.#change(
      this.#api.setRole(this.roomId(), group.groupId, select.value as MemberRole),
      $localize`:@@share.groups.error.role:The role could not be changed.`,
      (changed) =>
        this.groups.update((groups) =>
          groups.map((g) => (g.groupId === changed.groupId ? changed : g)),
        ),
      () => (select.value = group.role),
    );
  }

  protected remove(group: RoomGroup): void {
    this.#change(
      this.#api.remove(this.roomId(), group.groupId),
      $localize`:@@share.groups.error.remove:The group could not be removed.`,
      () => this.groups.update((groups) => groups.filter((g) => g.groupId !== group.groupId)),
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
        this.error.set(describeError(error, failure, 'room'));
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
      default:
        return $localize`:@@share.role.viewer:Viewer`;
    }
  }

  protected roleOfLabel(group: RoomGroup): string {
    return $localize`:@@share.groups.roleOf.label:Role of the group ${group.name}:name:`;
  }

  protected removeLabel(group: RoomGroup): string {
    return $localize`:@@share.groups.remove.label:Remove the group ${group.name}:name:`;
  }
}
