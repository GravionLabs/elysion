import { DatePipe } from '@angular/common';
import { Component, inject, input, signal } from '@angular/core';
import { type AuditEntry, describeAuditEntry } from '../audit/audit';
import { HistoryApi } from './history-api';
import type { MemberScope } from './members-api';

/**
 * "History" of the Share dialog (#669): the last 20 entries about who got access and who lost it, newest first. It is loaded when
 * the owner opens it, so a dialog that is only used to add a person costs no extra request.
 */
@Component({
  imports: [DatePipe],
  selector: 'app-share-history',
  styleUrl: './history.scss',
  templateUrl: './history.html',
})
export class ShareHistory {
  readonly #api = inject(HistoryApi);

  readonly boardId = input.required<string>();
  readonly scope = input<MemberScope>('board');

  protected readonly open = signal(false);
  protected readonly state = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  protected readonly entries = signal<AuditEntry[]>([]);
  protected readonly describe = describeAuditEntry;

  protected toggle(): void {
    this.open.update((open) => !open);
    if (this.open() && this.state() !== 'ready') {
      this.load();
    }
  }

  protected load(): void {
    this.state.set('loading');
    this.#api.list(this.boardId(), this.scope()).subscribe({
      next: (entries) => {
        this.entries.set(entries);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }
}
