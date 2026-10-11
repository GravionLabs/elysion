import { formatDate } from '@angular/common';
import { Component, LOCALE_ID, effect, inject, input, signal, untracked } from '@angular/core';
import { describeError } from './share-dialog';
import { type Invitation, type InvitationRole, InvitationsApi, inviteUrl } from './invitations-api';
import type { MemberScope } from './members-api';

/** The lifetimes a link is offered with, in hours. */
export const EXPIRY_CHOICES = [1, 24, 168, 720] as const;

/**
 * "Invite with a link" in the Share dialog (#734): make a link with a role, a lifetime and, if wanted, a number of uses; the
 * address is shown once, right after it was made (only a hash is stored, so an older link cannot be shown again), and the
 * active links are listed with how often they were used and a way to revoke them.
 */
@Component({
  selector: 'app-invite-links',
  styleUrl: './invite-links.scss',
  templateUrl: './invite-links.html',
})
export class InviteLinks {
  readonly #api = inject(InvitationsApi);
  readonly #locale = inject(LOCALE_ID);

  /** The id of the board, or of the room when `scope` is `room`. */
  readonly boardId = input.required<string>();
  readonly scope = input<MemberScope>('board');

  protected readonly expiryChoices = EXPIRY_CHOICES;
  protected readonly links = signal<Invitation[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly role = signal<InvitationRole>('Viewer');
  protected readonly hours = signal<number>(168);
  protected readonly maxUses = signal('');
  /** The link made last, until the person makes another one or leaves. */
  protected readonly created = signal<{ url: string; link: Invitation } | null>(null);
  /** What the copy button did: `copied`, or `manual` when the browser would not let the page write to the clipboard. */
  protected readonly copyState = signal<'idle' | 'copied' | 'manual'>('idle');

  constructor() {
    effect(() => {
      this.boardId();
      untracked(() => this.load());
    });
  }

  protected load(): void {
    this.loading.set(true);
    this.#api.list(this.boardId(), this.scope()).subscribe({
      next: (links) => {
        this.links.set(links);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.error.set(
          describeError(
            error,
            $localize`:@@invite.error.loadFailed:The links could not be loaded.`,
            this.scope(),
          ),
        );
      },
    });
  }

  protected updateRole(event: Event): void {
    this.role.set((event.target as HTMLSelectElement).value as InvitationRole);
  }

  protected updateHours(event: Event): void {
    this.hours.set(Number((event.target as HTMLSelectElement).value));
  }

  protected updateMaxUses(event: Event): void {
    this.maxUses.set((event.target as HTMLInputElement).value);
    this.error.set(null);
  }

  protected create(): void {
    const raw = this.maxUses().trim();
    const maxUses = raw === '' ? undefined : Number(raw);
    if (maxUses !== undefined && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1000)) {
      this.error.set(
        $localize`:@@invite.error.maxUses:The number of uses is a whole number from 1 to 1000, or empty.`,
      );
      return;
    }
    this.error.set(null);
    this.busy.set(true);
    this.copyState.set('idle');
    this.#api
      .create(this.boardId(), this.scope(), {
        role: this.role(),
        expiresInHours: this.hours(),
        ...(maxUses === undefined ? {} : { maxUses }),
      })
      .subscribe({
        next: ({ token, ...link }) => {
          this.busy.set(false);
          this.created.set({ url: inviteUrl(location.origin, token), link });
          this.links.update((links) => [link, ...links]);
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.error.set(
            describeError(
              error,
              $localize`:@@invite.error.createFailed:The link could not be made.`,
              this.scope(),
            ),
          );
        },
      });
  }

  protected revoke(link: Invitation): void {
    this.error.set(null);
    this.busy.set(true);
    this.#api.revoke(this.boardId(), this.scope(), link.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.links.update((links) => links.filter((l) => l.id !== link.id));
        if (this.created()?.link.id === link.id) this.created.set(null);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.error.set(
          describeError(
            error,
            $localize`:@@invite.error.revokeFailed:The link could not be revoked.`,
            this.scope(),
          ),
        );
      },
    });
  }

  protected async copy(): Promise<void> {
    const url = this.created()?.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      this.copyState.set('copied');
    } catch {
      // No clipboard permission (or an insecure page): the address is in a field the person can select.
      this.copyState.set('manual');
    }
  }

  protected selectAll(event: Event): void {
    (event.target as HTMLInputElement).select();
  }

  protected hoursLabel(hours: number): string {
    switch (hours) {
      case 1:
        return $localize`:@@invite.expiry.hour:1 hour`;
      case 24:
        return $localize`:@@invite.expiry.day:1 day`;
      case 168:
        return $localize`:@@invite.expiry.week:7 days`;
      default:
        return $localize`:@@invite.expiry.month:30 days`;
    }
  }

  protected roleLabel(role: InvitationRole): string {
    return role === 'Editor'
      ? $localize`:@@share.role.editor:Editor`
      : $localize`:@@share.role.viewer:Viewer`;
  }

  protected expiresOn(link: Invitation): string {
    return formatDate(link.expiresAt, 'medium', this.#locale);
  }

  /** "expires …, used 2 of 5" (or "used 2" for a link without a limit). */
  protected metaLabel(link: Invitation): string {
    const expires = this.expiresOn(link);
    return link.maxUses === null
      ? $localize`:@@invite.meta.unlimited:expires ${expires}:expires: · used ${link.uses}:uses:`
      : $localize`:@@invite.meta.limited:expires ${expires}:expires: · used ${link.uses}:uses: of ${link.maxUses}:max:`;
  }

  protected revokeLabel(link: Invitation): string {
    return $localize`:@@invite.revoke.label:Revoke the link for ${this.roleLabel(link.role)}:role: that expires ${this.expiresOn(link)}:expires:`;
  }
}
