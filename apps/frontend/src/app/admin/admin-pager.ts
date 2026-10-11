import { Component, input, output } from '@angular/core';

/** Previous and next for a paged admin table, with where the reader is ("Page 2 of 5, 112 in all"). */
@Component({
  selector: 'app-admin-pager',
  styleUrl: './admin-shared.scss',
  template: `
    <nav class="pager" aria-label="Pages" i18n-aria-label="@@admin.pager.label">
      <button
        type="button"
        class="button"
        [disabled]="page() <= 1"
        (click)="go.emit(page() - 1)"
        i18n="@@admin.pager.previous"
      >
        Previous
      </button>
      <span class="pager-text" role="status" i18n="@@admin.pager.position">
        Page {{ page() }} of {{ pages() }}, {{ total() }} in all
      </span>
      <button
        type="button"
        class="button"
        [disabled]="page() >= pages()"
        (click)="go.emit(page() + 1)"
        i18n="@@admin.pager.next"
      >
        Next
      </button>
    </nav>
  `,
})
export class AdminPager {
  readonly page = input.required<number>();
  readonly pages = input.required<number>();
  readonly total = input.required<number>();
  readonly go = output<number>();
}
