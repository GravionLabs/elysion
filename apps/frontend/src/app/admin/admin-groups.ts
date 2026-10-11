import { HttpClient } from '@angular/common/http';
import { Component, ElementRef, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { AUTH_SETTINGS_URL } from '../auth/auth-settings';
import {
  AdminApi,
  type AdminGroup,
  type AdminUser,
  type GroupMember,
  MAX_EXTERNAL_ID_LENGTH,
  MAX_GROUP_NAME_LENGTH,
} from './admin-api';
import { AdminDialog } from './admin-dialog';
import { AdminPager } from './admin-pager';
import { PAGE_SIZE, PagedList, describeAdminError } from './paged-list';

/** Which of the group dialogs is open, for which group. */
type Action = 'detail' | 'link' | 'unlink' | 'delete';

/**
 * The groups (#659, ADR 0027): a **local** group is made and kept here; a **linked** group belongs to the identity provider and
 * its members follow the claim as each person signs in. An administrator makes and renames groups, links a local group to a
 * provider group by its id (or unlinks it), adds and removes the members of a local group and deletes a group.
 */
@Component({
  imports: [AdminDialog, AdminPager],
  selector: 'app-admin-groups',
  styleUrls: ['./admin-shared.scss', './admin-groups.scss'],
  templateUrl: './admin-groups.html',
})
export class AdminGroups {
  readonly #api = inject(AdminApi);

  protected readonly maxName = MAX_GROUP_NAME_LENGTH;
  protected readonly maxExternalId = MAX_EXTERNAL_ID_LENGTH;

  protected readonly list = new PagedList<AdminGroup>((query, page, size) =>
    this.#api.groups(query, page, size),
  );
  protected readonly search = signal('');
  /** What went wrong with the last change, above the table. */
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  /** The provider's name for a linked group: what the shell goes to directly (`idpHint`), else a general word. */
  protected readonly providerName = signal<string | null>(null);

  // New group
  protected readonly creating = signal(false);
  protected readonly newName = signal('');
  protected readonly createError = signal<string | null>(null);
  private readonly newField = viewChild<ElementRef<HTMLInputElement>>('newField');

  // Rename in the table
  protected readonly renamingId = signal<string | null>(null);
  protected readonly renameDraft = signal('');
  private readonly renameField = viewChild<ElementRef<HTMLInputElement>>('renameField');

  // The dialogs
  protected readonly action = signal<Action | null>(null);
  protected readonly target = signal<AdminGroup | null>(null);
  protected readonly dialogError = signal<string | null>(null);
  protected readonly externalIdDraft = signal('');

  // The members of the group in the detail dialog
  protected readonly members = new PagedList<GroupMember>((_query, page, size) =>
    this.#api.members(this.target()!.id, page, size),
  );
  protected readonly candidateQuery = signal('');
  protected readonly candidates = signal<AdminUser[]>([]);
  protected readonly candidateState = signal<'idle' | 'loading' | 'done' | 'error'>('idle');

  constructor() {
    inject(Title).setTitle($localize`:@@admin.groups.pageTitle:Groups · Administration · Elysion`);
    this.list.load();
    inject(HttpClient)
      .get<Record<string, unknown>>(AUTH_SETTINGS_URL)
      .subscribe({
        next: (settings) => {
          const hint = settings['idpHint'];
          this.providerName.set(
            typeof hint === 'string' && hint.trim() !== '' ? hint.trim() : null,
          );
        },
        error: () => this.providerName.set(null),
      });
    effect(() => {
      const field = this.newField()?.nativeElement ?? this.renameField()?.nativeElement;
      if (field) {
        untracked(() => {
          field.focus();
          field.select();
        });
      }
    });
  }

  protected submitSearch(): void {
    this.list.search(this.search());
  }

  protected updateSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected sourceLabel(group: AdminGroup): string {
    return group.source === 'Local'
      ? $localize`:@@admin.groups.source.local:Local`
      : (this.providerName() ?? $localize`:@@admin.groups.source.provider:Identity provider`);
  }

  // --- New group
  protected startCreate(): void {
    this.error.set(null);
    this.createError.set(null);
    this.newName.set('');
    this.creating.set(true);
  }

  protected cancelCreate(): void {
    this.creating.set(false);
  }

  protected updateNewName(event: Event): void {
    this.newName.set((event.target as HTMLInputElement).value);
  }

  protected create(): void {
    const name = this.newName().trim();
    if (name === '' || name.length > MAX_GROUP_NAME_LENGTH) {
      this.createError.set(
        $localize`:@@admin.groups.nameRule:A group needs a name of 1 to ${MAX_GROUP_NAME_LENGTH}:max: characters.`,
      );
      return;
    }
    this.busy.set(true);
    this.#api.createGroup(name).subscribe({
      next: () => {
        this.busy.set(false);
        this.creating.set(false);
        this.list.load();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.createError.set(
          describeAdminError(
            error,
            $localize`:@@admin.groups.createError:The group could not be made.`,
          ),
        );
      },
    });
  }

  // --- Rename
  protected startRename(group: AdminGroup): void {
    this.error.set(null);
    this.renameDraft.set(group.name);
    this.renamingId.set(group.id);
  }

  protected cancelRename(): void {
    this.renamingId.set(null);
  }

  protected updateRenameDraft(event: Event): void {
    this.renameDraft.set((event.target as HTMLInputElement).value);
  }

  protected saveRename(group: AdminGroup): void {
    const name = this.renameDraft().trim();
    if (name === group.name) {
      this.renamingId.set(null);
      return;
    }
    if (name === '' || name.length > MAX_GROUP_NAME_LENGTH) {
      this.error.set(
        $localize`:@@admin.groups.nameRule:A group needs a name of 1 to ${MAX_GROUP_NAME_LENGTH}:max: characters.`,
      );
      return;
    }
    this.busy.set(true);
    this.#api.changeGroup(group.id, { name }).subscribe({
      next: (changed) => {
        this.busy.set(false);
        this.renamingId.set(null);
        this.#replace(changed);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.error.set(
          describeAdminError(
            error,
            $localize`:@@admin.groups.renameError:The group could not be renamed.`,
          ),
        );
      },
    });
  }

  // --- The dialogs
  protected openDialog(action: Action, group: AdminGroup): void {
    this.error.set(null);
    this.dialogError.set(null);
    this.target.set(group);
    this.externalIdDraft.set('');
    this.action.set(action);
    if (action === 'detail') {
      this.candidateQuery.set('');
      this.candidates.set([]);
      this.candidateState.set('idle');
      this.members.query.set('');
      this.members.page.set(1);
      this.members.load();
    }
  }

  protected closeDialog(): void {
    if (this.busy()) return;
    this.action.set(null);
    this.target.set(null);
  }

  protected updateExternalId(event: Event): void {
    this.externalIdDraft.set((event.target as HTMLInputElement).value);
  }

  protected link(): void {
    const group = this.target();
    const externalId = this.externalIdDraft().trim();
    if (!group) return;
    if (externalId === '' || externalId.length > MAX_EXTERNAL_ID_LENGTH) {
      this.dialogError.set(
        $localize`:@@admin.groups.link.rule:Enter the id of the group at the identity provider (up to ${MAX_EXTERNAL_ID_LENGTH}:max: characters).`,
      );
      return;
    }
    this.#change(
      group,
      { externalId },
      $localize`:@@admin.groups.link.error:The group could not be linked.`,
    );
  }

  protected unlink(): void {
    const group = this.target();
    if (group) {
      this.#change(
        group,
        { externalId: null },
        $localize`:@@admin.groups.unlink.error:The group could not be unlinked.`,
      );
    }
  }

  #change(group: AdminGroup, change: { externalId: string | null }, fallback: string): void {
    this.busy.set(true);
    this.dialogError.set(null);
    this.#api.changeGroup(group.id, change).subscribe({
      next: (changed) => {
        this.busy.set(false);
        this.action.set(null);
        this.target.set(null);
        this.#replace(changed);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.dialogError.set(describeAdminError(error, fallback));
      },
    });
  }

  protected remove(): void {
    const group = this.target();
    if (!group) return;
    this.busy.set(true);
    this.dialogError.set(null);
    this.#api.deleteGroup(group.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.action.set(null);
        this.target.set(null);
        // The page may have been the last one of the list.
        this.list.load();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.dialogError.set(
          describeAdminError(
            error,
            $localize`:@@admin.groups.delete.error:The group could not be deleted.`,
          ),
        );
      },
    });
  }

  // --- Members of a local group
  protected updateCandidateQuery(event: Event): void {
    this.candidateQuery.set((event.target as HTMLInputElement).value);
  }

  protected findCandidates(): void {
    const query = this.candidateQuery().trim();
    if (query === '') {
      this.candidates.set([]);
      this.candidateState.set('idle');
      return;
    }
    this.candidateState.set('loading');
    this.#api.users(query, 1, 8).subscribe({
      next: (answer) => {
        this.candidates.set(answer.items);
        this.candidateState.set('done');
      },
      error: () => this.candidateState.set('error'),
    });
  }

  protected addMember(user: AdminUser): void {
    const group = this.target();
    if (!group) return;
    this.busy.set(true);
    this.dialogError.set(null);
    this.#api.addMember(group.id, user.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.members.load();
        this.#refreshCounts();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.dialogError.set(
          describeAdminError(
            error,
            $localize`:@@admin.groups.addError:The person could not be added.`,
          ),
        );
      },
    });
  }

  protected removeMember(member: GroupMember): void {
    const group = this.target();
    if (!group) return;
    this.busy.set(true);
    this.dialogError.set(null);
    this.#api.removeMember(group.id, member.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.members.load();
        this.#refreshCounts();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.dialogError.set(
          describeAdminError(
            error,
            $localize`:@@admin.groups.removeError:The person could not be removed.`,
          ),
        );
      },
    });
  }

  // --- Labels
  protected renameLabel(group: AdminGroup): string {
    return $localize`:@@admin.groups.rename.aria:Rename the group ${group.name}:name:`;
  }

  protected linkLabel(group: AdminGroup): string {
    return $localize`:@@admin.groups.link.aria:Link the group ${group.name}:name: to a group of the identity provider`;
  }

  protected unlinkLabel(group: AdminGroup): string {
    return $localize`:@@admin.groups.unlink.aria:Unlink the group ${group.name}:name:`;
  }

  protected deleteLabel(group: AdminGroup): string {
    return $localize`:@@admin.groups.delete.aria:Delete the group ${group.name}:name:`;
  }

  protected openLabel(group: AdminGroup): string {
    return $localize`:@@admin.groups.open:Show the members of ${group.name}:name:`;
  }

  protected removeLabel(member: GroupMember): string {
    return $localize`:@@admin.groups.removeMember.aria:Remove ${member.displayName}:name: from the group`;
  }

  protected addLabel(user: AdminUser): string {
    return $localize`:@@admin.groups.addMember.aria:Add ${user.displayName}:name: to the group`;
  }

  /** The row of the list and the open dialog show the changed group at once; the counts follow with the next load. */
  #replace(changed: AdminGroup): void {
    this.list.items.update((items) => items.map((g) => (g.id === changed.id ? changed : g)));
  }

  #refreshCounts(): void {
    const id = this.target()?.id;
    this.#api.groups(this.list.query(), this.list.page(), PAGE_SIZE).subscribe({
      next: (answer) => {
        this.list.items.set(answer.items);
        this.list.total.set(answer.total);
        const fresh = answer.items.find((g) => g.id === id);
        if (fresh) this.target.set(fresh);
      },
    });
  }
}
