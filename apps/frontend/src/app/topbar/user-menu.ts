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
import type { SessionUser } from '../auth/session.service';

/** The signed-in user in the top bar: their name, and a menu to log out. */
@Component({
  selector: 'app-user-menu',
  styleUrl: './user-menu.scss',
  templateUrl: './user-menu.html',
})
export class UserMenu {
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);

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
