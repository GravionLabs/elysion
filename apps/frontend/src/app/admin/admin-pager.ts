import { Component, input, output } from '@angular/core';

/** Previous and next for a paged admin table, with where the reader is ("Page 2 of 5, 112 in all"). */
@Component({
  selector: 'app-admin-pager',
  styleUrl: './admin-shared.scss',
  templateUrl: './admin-pager.html',
})
export class AdminPager {
  readonly page = input.required<number>();
  readonly pages = input.required<number>();
  readonly total = input.required<number>();
  readonly go = output<number>();
}
