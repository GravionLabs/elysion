import { Component, ElementRef, HostListener, inject, input, output, signal } from '@angular/core';

/**
 * The Present part of the top bar (#848): editors and owners make everybody follow their view ("Start presenting" /
 * "Stop presenting") or bring everybody to where they are once ("Bring everyone to me"). A viewer has no button; the
 * top bar does not render this component for them. While somebody presents, the button is marked.
 */
@Component({
  selector: 'app-present-menu',
  styleUrl: './present-menu.scss',
  templateUrl: './present-menu.html',
})
export class PresentMenu {
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** This person presents now: the menu offers to stop. */
  readonly presenting = input(false);
  /** Somebody presents, this person or another: the button is marked. */
  readonly active = input(false);

  readonly startRequested = output<void>();
  readonly stopRequested = output<void>();
  readonly summonRequested = output<void>();

  protected readonly open = signal(false);

  protected toggle(): void {
    this.open.update((open) => !open);
  }

  protected togglePresenting(): void {
    this.open.set(false);
    if (this.presenting()) {
      this.stopRequested.emit();
    } else {
      this.startRequested.emit();
    }
  }

  protected summon(): void {
    this.open.set(false);
    this.summonRequested.emit();
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
