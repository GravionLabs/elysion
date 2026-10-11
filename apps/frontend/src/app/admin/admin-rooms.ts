import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RoomApi } from '../board/room-api';
import { ShareDialog } from '../share/share-dialog';
import { AdminApi, type AdminRoom } from './admin-api';
import { AdminPager } from './admin-pager';
import { PagedList } from './paged-list';

/**
 * The rooms of the instance (#659): name, owner, counts, no board names and no content. The only action is the Share dialog of a room
 * the administrator owns themselves; an administrator has no role on a room by being one (ADR 0027).
 */
@Component({
  imports: [AdminPager, DatePipe, ShareDialog],
  selector: 'app-admin-rooms',
  styleUrl: './admin-shared.scss',
  templateUrl: './admin-rooms.html',
})
export class AdminRooms {
  readonly #api = inject(AdminApi);

  protected readonly list = new PagedList<AdminRoom>((query, page, size) =>
    this.#api.rooms(query, page, size),
  );
  protected readonly search = signal('');
  /** The rooms the administrator owns, by id: where the Share button is offered. */
  protected readonly owned = signal<ReadonlySet<string>>(new Set());
  protected readonly sharing = signal<AdminRoom | null>(null);

  constructor() {
    inject(Title).setTitle($localize`:@@admin.rooms.pageTitle:Rooms · Administration · Elysion`);
    this.list.load();
    inject(RoomApi)
      .list()
      .subscribe({
        next: (rooms) =>
          this.owned.set(new Set(rooms.filter((room) => room.role === 'Owner').map((r) => r.id))),
        error: () => this.owned.set(new Set()),
      });
  }

  protected submit(): void {
    this.list.search(this.search());
  }

  protected updateSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected shareLabel(room: AdminRoom): string {
    return $localize`:@@admin.rooms.share.aria:Share the room ${room.name}:name:`;
  }
}
