import { HttpErrorResponse } from '@angular/common/http';
import { computed, signal } from '@angular/core';
import type { Observable } from 'rxjs';
import type { Page } from './admin-api';

/** How many rows a page of an admin table has. */
export const PAGE_SIZE = 25;

export type ListState = 'loading' | 'ready' | 'error';

/** The message to show for a failed admin call: the API's own where it has one, else the fallback. */
export function describeAdminError(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as { detail?: unknown; message?: unknown } | null;
    for (const text of [body?.detail, body?.message]) {
      if (typeof text === 'string' && text.trim() !== '') {
        return text;
      }
    }
    if (error.status === 403) {
      return $localize`:@@admin.error.forbidden:Only an administrator can do this.`;
    }
  }
  return fallback;
}

/**
 * One searchable, paged list of an admin table: the text searched for, the page, the rows and whether they are loading. A
 * request that was overtaken by a newer one (a quick second search) is ignored when it arrives.
 */
export class PagedList<T> {
  readonly query = signal('');
  readonly page = signal(1);
  readonly items = signal<T[]>([]);
  readonly total = signal(0);
  readonly state = signal<ListState>('loading');
  readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));
  #request = 0;

  constructor(
    private readonly fetch: (query: string, page: number, pageSize: number) => Observable<Page<T>>,
  ) {}

  load(): void {
    const request = ++this.#request;
    this.state.set('loading');
    this.fetch(this.query(), this.page(), PAGE_SIZE).subscribe({
      next: (answer) => {
        if (request !== this.#request) return;
        this.items.set(answer.items);
        this.total.set(answer.total);
        this.state.set('ready');
      },
      error: () => {
        if (request !== this.#request) return;
        this.state.set('error');
      },
    });
  }

  /** A new search starts at the first page. */
  search(query: string): void {
    this.query.set(query.trim());
    this.page.set(1);
    this.load();
  }

  go(page: number): void {
    const next = Math.min(Math.max(1, page), this.pages());
    if (next !== this.page()) {
      this.page.set(next);
      this.load();
    }
  }
}
