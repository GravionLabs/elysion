import {
  Component,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { MAX_ROOM_NAME_LENGTH, RoomApi, RoomInfo, canWriteInRoom } from '../board/room-api';
import { describeError } from '../share/share-dialog';

/** What the sidebar says about the rooms list: it loads on its own, apart from the boards. */
export type RoomsState = 'loading' | 'ready' | 'error';

/**
 * The left column of the board overview (ADR 0019): "All boards", "Not in a room" and the user's rooms with their
 * board counts, each a link to a view of the list (`/`, `/rooms/none`, `/rooms/:id`), and **New room**. It also takes
 * a board dropped on a room (or on "Not in a room"), as the pointer's way to move it; the list page owns the board
 * and tells the sidebar only whether one is being dragged. On a phone it becomes a row of chips.
 */
@Component({
  imports: [RouterLink],
  selector: 'app-room-sidebar',
  styleUrl: './room-sidebar.scss',
  templateUrl: './room-sidebar.html',
})
export class RoomSidebar {
  readonly #api = inject(RoomApi);

  readonly rooms = input.required<readonly RoomInfo[]>();
  readonly state = input<RoomsState>('ready');
  /** The view that is open: `undefined` for all boards, `none` for boards in no room, else a room's id. */
  readonly selected = input<string | undefined>();
  readonly total = input(0);
  readonly unassigned = input(0);
  readonly counts = input<Readonly<Record<string, number>>>({});
  /** Whether a board is being dragged: the entries that can take it light up. */
  readonly dragging = input(false);

  readonly roomAdded = output<RoomInfo>();
  /** A board was dropped on a room, or on `null` (take it out of its room). */
  readonly boardDropped = output<string | null>();
  readonly retry = output<void>();

  protected readonly maxNameLength = MAX_ROOM_NAME_LENGTH;
  protected readonly adding = signal(false);
  protected readonly draft = signal('');
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  /** The entry a dragged board is over: `none` or a room's id. */
  protected readonly dropTarget = signal<string | null>(null);

  private readonly nameField = viewChild<ElementRef<HTMLInputElement>>('nameField');

  constructor() {
    effect(() => {
      const field = this.nameField()?.nativeElement;
      if (field) {
        untracked(() => field.focus());
      }
    });
  }

  protected openAdd(): void {
    this.draft.set('');
    this.error.set(null);
    this.adding.set(true);
  }

  protected cancelAdd(): void {
    if (!this.saving()) {
      this.adding.set(false);
    }
  }

  protected updateDraft(event: Event): void {
    this.draft.set((event.target as HTMLInputElement).value);
    this.error.set(null);
  }

  protected add(): void {
    if (this.saving()) {
      return;
    }
    const name = this.draft().trim();
    if (!name) {
      this.error.set('Give the room a name.');
      return;
    }
    if (name.length > MAX_ROOM_NAME_LENGTH) {
      this.error.set(`The name can have up to ${MAX_ROOM_NAME_LENGTH} characters.`);
      return;
    }
    this.saving.set(true);
    this.#api.create(name).subscribe({
      next: (room) => {
        this.saving.set(false);
        this.adding.set(false);
        this.roomAdded.emit(room);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.error.set(describeError(error, 'The room could not be created. Try again.', 'room'));
      },
    });
  }

  protected canDropOn(room: RoomInfo | null): boolean {
    return this.dragging() && (room === null || canWriteInRoom(room));
  }

  protected dragOver(event: DragEvent, room: RoomInfo | null): void {
    if (this.canDropOn(room)) {
      event.preventDefault();
      this.dropTarget.set(room?.id ?? 'none');
    }
  }

  protected dragLeave(key: string): void {
    if (this.dropTarget() === key) {
      this.dropTarget.set(null);
    }
  }

  protected drop(event: DragEvent, room: RoomInfo | null): void {
    this.dropTarget.set(null);
    if (this.canDropOn(room)) {
      event.preventDefault();
      this.boardDropped.emit(room?.id ?? null);
    }
  }
}
