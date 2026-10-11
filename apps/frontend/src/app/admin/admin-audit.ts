import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { type AuditEntry, describeAuditEntry } from '../audit/audit';
import { AdminApi, type AuditFilter } from './admin-api';
import { AdminPager } from './admin-pager';
import { PagedList } from './paged-list';

/** What an active filter says about itself: which kind it is, the id sent and the name shown. */
interface Chip {
  key: 'subject' | 'actor';
  id: string;
  label: string;
}

/**
 * The audit log of the instance (#669): who changed who may see what, newest first, with the dates and two chips as filters. A click
 * on a subject or a person in a row filters by it, so nobody has to type an id. Only ids, roles and counts are in an entry.
 */
@Component({
  imports: [AdminPager, DatePipe],
  selector: 'app-admin-audit',
  styleUrl: './admin-shared.scss',
  templateUrl: './admin-audit.html',
})
export class AdminAudit {
  readonly #api = inject(AdminApi);

  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly chips = signal<Chip[]>([]);
  protected readonly describe = describeAuditEntry;

  // The list only pages; what is searched for is the filter, read when a page is fetched.
  protected readonly list = new PagedList<AuditEntry>((_query, page, size) =>
    this.#api.audit(this.#filter(), page, size),
  );

  constructor() {
    inject(Title).setTitle($localize`:@@admin.audit.pageTitle:Audit · Administration · Elysion`);
    this.list.load();
  }

  #filter(): AuditFilter {
    const chip = (key: Chip['key']) => this.chips().find((c) => c.key === key)?.id;
    // The end date is a whole day: up to, and not including, the next one.
    const to = this.to();
    return {
      subject: chip('subject'),
      actor: chip('actor'),
      from: this.from() || undefined,
      to: to ? nextDay(to) : undefined,
    };
  }

  protected apply(): void {
    this.list.search('');
  }

  protected updateFrom(event: Event): void {
    this.from.set((event.target as HTMLInputElement).value);
  }

  protected updateTo(event: Event): void {
    this.to.set((event.target as HTMLInputElement).value);
  }

  protected filterBy(key: Chip['key'], id: string | null, label: string | null): void {
    if (!id) return;
    this.chips.update((chips) => [
      ...chips.filter((c) => c.key !== key),
      { key, id, label: label ?? id },
    ]);
    this.apply();
  }

  protected removeChip(chip: Chip): void {
    this.chips.update((chips) => chips.filter((c) => c !== chip));
    this.apply();
  }

  protected chipText(chip: Chip): string {
    return chip.key === 'subject'
      ? $localize`:@@admin.audit.chip.subject:About: ${chip.label}:name:`
      : $localize`:@@admin.audit.chip.actor:By: ${chip.label}:name:`;
  }

  protected removeLabel(chip: Chip): string {
    return $localize`:@@admin.audit.chip.remove:Remove the filter ${this.chipText(chip)}:filter:`;
  }

  protected subjectLabel(entry: AuditEntry): string {
    const kind =
      entry.subjectType === 'board'
        ? $localize`:@@admin.audit.kind.board:Board`
        : entry.subjectType === 'room'
          ? $localize`:@@admin.audit.kind.room:Room`
          : entry.subjectType === 'group'
            ? $localize`:@@admin.audit.kind.group:Group`
            : $localize`:@@admin.audit.kind.user:Person`;
    return `${kind}: ${entry.subjectName ?? $localize`:@@admin.audit.gone:(gone)`}`;
  }
}

/** The day after a `YYYY-MM-DD` date, in the same form. */
export function nextDay(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}
