import { Component, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { RoomApi, canAdministerRoom, type RoomInfo } from '../board/room-api';
import { GroupsApi, type RoomGroup } from './groups-api';
import { MembersApi } from './members-api';

/**
 * Who else can open a board that is in a room (ADR 0019, #652): the room's people and groups reach every board in it. Shown in the
 * board's Share dialog as a plain explanation with no controls; the room's own dialog is where they change. The people count is
 * only there for an owner of the room (the member list is theirs); the groups are listed for everybody who sees the room.
 */
@Component({
  imports: [RouterLink],
  selector: 'app-room-access',
  styleUrl: './room-access.scss',
  templateUrl: './room-access.html',
})
export class RoomAccess {
  readonly #rooms = inject(RoomApi);
  readonly #groups = inject(GroupsApi);
  readonly #members = inject(MembersApi);

  /** The room the board is in. */
  readonly roomId = input.required<string>();

  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly room = signal<RoomInfo | null>(null);
  protected readonly groups = signal<RoomGroup[]>([]);
  /** How many people have a role in the room itself, or `null` when the caller may not list them. */
  protected readonly people = signal<number | null>(null);
  protected readonly canManage = signal(false);

  constructor() {
    queueMicrotask(() => this.load());
  }

  protected load(): void {
    this.state.set('loading');
    const id = this.roomId();
    forkJoin({
      rooms: this.#rooms.list(),
      groups: this.#groups.listForRoom(id),
      members: this.#members.list(id, 'room').pipe(catchError(() => of(null))),
    }).subscribe({
      next: ({ rooms, groups, members }) => {
        const room = rooms.find((r) => r.id === id) ?? null;
        this.room.set(room);
        this.groups.set(groups);
        this.people.set(members ? members.length : null);
        this.canManage.set(room !== null && canAdministerRoom(room));
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  protected groupList(): string {
    return this.groups()
      .map((group) => this.groupText(group))
      .join(', ');
  }

  protected groupText(group: RoomGroup): string {
    switch (group.role) {
      case 'Owner':
        return $localize`:@@share.access.group.owner:${group.name}:name: (Owner)`;
      case 'Editor':
        return $localize`:@@share.access.group.editor:${group.name}:name: (Editor)`;
      default:
        return $localize`:@@share.access.group.viewer:${group.name}:name: (Viewer)`;
    }
  }
}
