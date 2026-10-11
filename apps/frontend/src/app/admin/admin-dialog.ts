import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  inject,
  input,
  output,
} from '@angular/core';

let nextId = 0;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal panel of the admin pages (the detail of a person or a group, a confirmation): a dialog with a heading, focus that goes
 * into it and comes back to the button that opened it, Tab that stays inside, and Escape or a click outside that close it.
 */
@Component({
  selector: 'app-admin-dialog',
  styleUrl: './admin-shared.scss',
  template: `
    <div class="backdrop" (click)="closed.emit()">
      <div
        #panel
        class="dialog"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        [attr.aria-labelledby]="titleId"
        (click)="$event.stopPropagation()"
      >
        <header class="dialog-header">
          <h2 [id]="titleId">{{ heading() }}</h2>
          <button
            type="button"
            class="close"
            aria-label="Close"
            i18n-aria-label="@@admin.dialog.close"
            (click)="closed.emit()"
          >
            ×
          </button>
        </header>
        <ng-content />
      </div>
    </div>
  `,
})
export class AdminDialog {
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly heading = input.required<string>();
  readonly closed = output<void>();

  protected readonly titleId = `admin-dialog-title-${nextId++}`;

  constructor() {
    // The button that opened the dialog gets the focus back when it is gone (WCAG 2.4.3).
    const opener = document.activeElement;
    inject(DestroyRef).onDestroy(() => {
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus();
      }
    });
    // The focus goes in once the content is there: to the first field or button after the close button.
    queueMicrotask(() => {
      const panel = this.#panel();
      const first = panel?.querySelectorAll<HTMLElement>(FOCUSABLE)[1] ?? panel;
      first?.focus();
    });
  }

  #panel(): HTMLElement | null {
    return this.#host.nativeElement.querySelector('.dialog');
  }

  @HostListener('keydown.escape', ['$event'])
  protected onEscape(event: Event): void {
    event.stopPropagation();
    this.closed.emit();
  }

  // `keydown.tab` would not match Shift+Tab, so all keys come here.
  @HostListener('keydown', ['$event'])
  protected keepFocusInside(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const panel = this.#panel();
    if (!panel) return;
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const shift = event.shiftKey;
    const active = document.activeElement;
    if (shift && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!shift && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
