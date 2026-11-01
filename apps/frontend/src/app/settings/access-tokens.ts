import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { AdminDialog } from '../admin/admin-dialog';
import { describeAdminError } from '../admin/paged-list';
import { SessionService } from '../auth/session.service';
import { AppBrand } from '../shared/app-brand';
import { UserMenu } from '../topbar/user-menu';
import {
  API_SCOPES,
  type AccessTokenItem,
  AccessTokensApi,
  type CreatedAccessToken,
  EXPIRY_CHOICES,
  MAX_TOKEN_NAME_LENGTH,
} from './access-tokens-api';
import { describeScope } from './scope-labels';

/**
 * "Access tokens" in the person's settings (ADR 0033, #851): make a personal access token for a script (a name, the scopes, an
 * expiry of at most a year), see its secret once with a copy button, list the tokens with their last use, revoke one. The secret is
 * kept in this component only while it is shown; it is never stored and never shown again.
 */
@Component({
  imports: [AdminDialog, AppBrand, DatePipe, RouterLink, UserMenu],
  selector: 'app-access-tokens',
  styleUrls: ['../admin/admin-shared.scss', './access-tokens.scss'],
  templateUrl: './access-tokens.html',
})
export class AccessTokens {
  readonly #api = inject(AccessTokensApi);
  protected readonly session = inject(SessionService);

  protected readonly scopes = API_SCOPES;
  protected readonly expiries = EXPIRY_CHOICES;
  protected readonly maxName = MAX_TOKEN_NAME_LENGTH;
  protected readonly describeScope = describeScope;

  protected readonly tokens = signal<AccessTokenItem[]>([]);
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');

  protected readonly name = signal('');
  protected readonly chosen = signal<ReadonlySet<string>>(new Set(['boards:read']));
  protected readonly expiresInDays = signal<number>(30);
  protected readonly creating = signal(false);
  protected readonly createError = signal<string | null>(null);
  protected readonly canCreate = computed(
    () => this.name().trim() !== '' && this.chosen().size > 0 && !this.creating(),
  );

  /** The token just made, with its secret: shown until the person closes it. */
  protected readonly created = signal<CreatedAccessToken | null>(null);
  protected readonly copied = signal(false);

  /** The token the person asked to revoke, until they confirm or cancel. */
  protected readonly revoking = signal<AccessTokenItem | null>(null);
  protected readonly revokeBusy = signal(false);
  protected readonly revokeError = signal<string | null>(null);

  /** The clock the list compares expiries with; a field so tests can set it. */
  protected now = () => Date.now();

  constructor() {
    inject(Title).setTitle($localize`:@@tokens.pageTitle:Access tokens · Elysion`);
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    this.#api.list().subscribe({
      next: (tokens) => {
        this.tokens.set(tokens);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  protected updateName(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
  }

  protected toggleScope(scope: string, event: Event): void {
    const on = (event.target as HTMLInputElement).checked;
    this.chosen.update((current) => {
      const next = new Set(current);
      if (on) next.add(scope);
      else next.delete(scope);
      return next;
    });
  }

  protected updateExpiry(event: Event): void {
    this.expiresInDays.set(Number((event.target as HTMLSelectElement).value));
  }

  protected create(): void {
    if (!this.canCreate()) return;
    this.creating.set(true);
    this.createError.set(null);
    this.#api
      .create({
        name: this.name().trim(),
        // In the order of the list, whatever order they were ticked in.
        scopes: API_SCOPES.filter((scope) => this.chosen().has(scope)),
        expiresInDays: this.expiresInDays(),
      })
      .subscribe({
        next: (token) => {
          this.creating.set(false);
          this.copied.set(false);
          this.created.set(token);
          this.name.set('');
          const { token: _secret, ...item } = token;
          this.tokens.update((tokens) => [item, ...tokens]);
        },
        error: (error: unknown) => {
          this.creating.set(false);
          this.createError.set(
            describeAdminError(
              error,
              $localize`:@@tokens.create.error:The token could not be created.`,
            ),
          );
        },
      });
  }

  protected async copy(secret: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(secret);
      this.copied.set(true);
    } catch {
      // No clipboard (an insecure page, a refusal): the field is selected so the person can copy it themselves.
      this.copied.set(false);
    }
  }

  protected selectAll(event: Event): void {
    (event.target as HTMLInputElement).select();
  }

  protected dismissCreated(): void {
    this.created.set(null);
    this.copied.set(false);
  }

  protected askRevoke(token: AccessTokenItem): void {
    this.revokeError.set(null);
    this.revoking.set(token);
  }

  protected cancelRevoke(): void {
    if (!this.revokeBusy()) this.revoking.set(null);
  }

  protected revoke(): void {
    const token = this.revoking();
    if (!token || this.revokeBusy()) return;
    this.revokeBusy.set(true);
    this.revokeError.set(null);
    this.#api.revoke(token.id).subscribe({
      next: () => {
        this.revokeBusy.set(false);
        this.revoking.set(null);
        this.tokens.update((tokens) => tokens.filter((t) => t.id !== token.id));
        if (this.created()?.id === token.id) this.dismissCreated();
      },
      error: (error: unknown) => {
        this.revokeBusy.set(false);
        this.revoking.set(null);
        this.revokeError.set(
          describeAdminError(
            error,
            $localize`:@@tokens.revoke.error:The token could not be revoked.`,
          ),
        );
      },
    });
  }

  protected isExpired(token: AccessTokenItem): boolean {
    return Date.parse(token.expiresAt) <= this.now();
  }

  protected revokeLabel(token: AccessTokenItem): string {
    return $localize`:@@tokens.revoke.aria:Revoke ${token.name}:name:`;
  }

  protected expiryLabel(days: number): string {
    return days === 365
      ? $localize`:@@tokens.expiry.year:1 year`
      : $localize`:@@tokens.expiry.days:${days}:days: days`;
  }
}
