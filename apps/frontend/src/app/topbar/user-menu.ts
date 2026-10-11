import {
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Account } from '../auth/account';
import type { SessionUser } from '../auth/session.service';
import { LANGUAGES, LanguageService } from '../shared/language';

/** The signed-in user in the top bar: their name, and a menu to switch the language and to log out. */
@Component({
  imports: [RouterLink],
  selector: 'app-user-menu',
  styleUrl: './user-menu.scss',
  templateUrl: './user-menu.html',
})
export class UserMenu {
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly languageService = inject(LanguageService);
  protected readonly languages = LANGUAGES;
  /** Whether the person administers the instance: the menu then has a way to the administration (ADR 0027). */
  protected readonly isAdministrator = inject(Account).isAdministrator;

  readonly user = input.required<SessionUser>();
  readonly logoutRequested = output<void>();

  protected readonly open = signal(false);
  protected readonly initials = computed(
    () =>
      this.user()
        .name.split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((word) => [...word][0].toUpperCase())
        .join('') || '?',
  );

  protected readonly signedInLabel = computed(
    () => $localize`:@@topbar.user.signed-in:Signed in as ${this.user().name}:name:`,
  );

  protected toggle(): void {
    this.open.update((open) => !open);
  }

  protected logout(): void {
    this.open.set(false);
    this.logoutRequested.emit();
  }

  @HostListener('document:click', ['$event'])
  protected closeOnOutsideClick(event: Event): void {
    if (this.open() && !this.#host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }

  @HostListener('keydown.escape')
  protected closeOnEscape(): void {
    this.open.set(false);
  }
}
