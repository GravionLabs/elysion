import { DatePipe } from '@angular/common';
import {
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { AppBrand } from '../shared/app-brand';
import { SessionService } from '../auth/session.service';
import { UserMenu } from '../topbar/user-menu';
import { ThemeService } from '../theme/theme.service';
import { BoardApi, BoardInfo, MAX_BOARD_NAME_LENGTH } from '../board/board-api';
import { TEMPLATE_STATE_KEY, TemplateApi, TemplateInfo } from '../board/template-api';
import {
  MAX_ROOM_NAME_LENGTH,
  RoomApi,
  RoomInfo,
  canAdministerRoom,
  canWriteInRoom,
} from '../board/room-api';
import { describeError, ShareDialog } from '../share/share-dialog';
import { BoardThumbnail } from './board-thumbnail';
import { RoomSidebar, RoomsState } from './room-sidebar';

/** The design tokens the preview placeholders are tinted with; a board always gets the same one. */
const PREVIEW_TINTS = [
  '--c-node-red',
  '--c-node-orange',
  '--c-node-amber',
  '--c-node-green',
  '--c-node-teal',
  '--c-node-blue',
  '--c-node-purple',
  '--c-node-pink',
];

/** Up to two letters standing for the board in its preview: the first letters of the first two words. */
export function boardInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '').slice(0, 2);
  return letters.toUpperCase() || '?';
}

/** The CSS color of a board's preview: one of the node tokens, chosen from the id so it is stable. */
export function boardTint(id: string): string {
  let hash = 0;
  for (const char of id) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `var(${PREVIEW_TINTS[hash % PREVIEW_TINTS.length]})`;
}

export const DEFAULT_NEW_BOARD_NAME = $localize`:@@boards.defaultName:Untitled board`;

type ListState = 'loading' | 'ready' | 'error';
type CreateState = 'closed' | 'editing' | 'saving';

/** One way to move a board: into a room, or (`roomId` null) out of its room. */
export interface MoveOption {
  roomId: string | null;
  label: string;
}

/**
 * The home page: the boards, newest first, and a way to start a new one, with the rooms in a sidebar (ADR 0019). The
 * route decides the view through `roomId`: no value is all boards, `none` the boards in no room, else one room.
 */
@Component({
  imports: [AppBrand, BoardThumbnail, DatePipe, RouterLink, RoomSidebar, ShareDialog, UserMenu],
  selector: 'app-board-list',
  styleUrls: ['./board-list.scss', './board-list-create.scss', './board-list-cards.scss'],
  templateUrl: './board-list.html',
})
export class BoardList {
  protected readonly session = inject(SessionService);
  readonly #api = inject(BoardApi);
  readonly #roomApi = inject(RoomApi);
  readonly #templateApi = inject(TemplateApi);
  readonly #router = inject(Router);
  readonly #pageTitle = inject(Title);
  // Injected so the theme is applied to the page, which the board page does through its top bar.
  readonly #theme = inject(ThemeService);

  /** The view, from the route: `undefined` for all boards, `none` for boards in no room, else a room's id. */
  readonly roomId = input<string | undefined>();

  protected readonly canWriteRoom = canWriteInRoom;
  protected readonly canAdministerRoom = canAdministerRoom;
  protected readonly maxRoomNameLength = MAX_ROOM_NAME_LENGTH;
  protected readonly initials = boardInitials;
  protected readonly tint = boardTint;
  protected readonly maxNameLength = MAX_BOARD_NAME_LENGTH;
  protected readonly theme = this.#theme.theme;

  protected readonly state = signal<ListState>('loading');
  protected readonly boards = signal<BoardInfo[]>([]);

  protected readonly createState = signal<CreateState>('closed');
  #createOpener: Element | null = null;
  protected readonly draftName = signal(DEFAULT_NEW_BOARD_NAME);
  protected readonly createError = signal<string | null>(null);

  /** The catalog for the New board form; empty until it loaded and when it failed (then only Blank is offered). */
  protected readonly templates = signal<TemplateInfo[]>([]);

  /** The template chosen in the New board form; `null` is a blank board. */
  protected readonly selectedTemplateId = signal<string | null>(null);

  /** The board the user is being asked about; `null` when no deletion is pending. */
  protected readonly deleteTarget = signal<BoardInfo | null>(null);
  protected readonly deleting = signal(false);
  protected readonly deleteError = signal<string | null>(null);

  /** The board being duplicated, while the request runs, and the message when it failed. */
  protected readonly duplicatingId = signal<string | null>(null);
  protected readonly duplicateError = signal<string | null>(null);

  /** The user's rooms; they load apart from the boards, so a failing room list does not hide the boards. */
  protected readonly rooms = signal<RoomInfo[]>([]);
  protected readonly roomsState = signal<RoomsState>('loading');

  protected readonly view = computed<'all' | 'none' | 'room'>(() => {
    const id = this.roomId();
    return id === undefined ? 'all' : id === 'none' ? 'none' : 'room';
  });

  /** The room that is open, or `null` (another view, the rooms are not loaded yet, or there is no such room). */
  protected readonly currentRoom = computed(() =>
    this.view() === 'room'
      ? (this.rooms().find((room) => room.id === this.roomId()) ?? null)
      : null,
  );

  /** A room view whose room is not among the user's rooms: it does not exist, or the user has no role in it. */
  protected readonly roomMissing = computed(
    () => this.view() === 'room' && this.roomsState() === 'ready' && this.currentRoom() === null,
  );

  protected readonly title = computed(() => {
    switch (this.view()) {
      case 'all':
        return $localize`:@@boards.title.all:Boards`;
      case 'none':
        return $localize`:@@boards.sidebar.none:Not in a room`;
      default:
        return (
          this.currentRoom()?.name ??
          (this.roomMissing()
            ? $localize`:@@boards.roomMissing.title:Room not found`
            : $localize`:@@boards.title.room:Room`)
        );
    }
  });

  protected readonly visibleBoards = computed(() => {
    const boards = this.boards();
    switch (this.view()) {
      case 'all':
        return boards;
      case 'none':
        return boards.filter((board) => board.roomId === null);
      default:
        return boards.filter((board) => board.roomId === this.roomId());
    }
  });

  protected readonly roomCounts = computed(() => {
    const counts: Record<string, number> = {};
    for (const board of this.boards()) {
      if (board.roomId !== null) {
        counts[board.roomId] = (counts[board.roomId] ?? 0) + 1;
      }
    }
    return counts;
  });

  protected readonly unassignedCount = computed(
    () => this.boards().filter((board) => board.roomId === null).length,
  );

  /** New board is for everybody in the all and no-room views, and in a room for those who may write in it. */
  protected readonly canCreateBoard = computed(() => {
    if (this.view() !== 'room') {
      return true;
    }
    const room = this.currentRoom();
    return room !== null && canWriteInRoom(room);
  });

  /** What went wrong with a room or a move, shown above the boards. */
  protected readonly roomError = signal<string | null>(null);

  protected readonly renaming = signal(false);
  protected readonly renameDraft = signal('');
  protected readonly renameSaving = signal(false);

  protected readonly roomDeleteTarget = signal<RoomInfo | null>(null);
  protected readonly roomDeleting = signal(false);
  protected readonly roomDeleteError = signal<string | null>(null);

  /** Whether the members of the open room are being edited. */
  protected readonly shareRoomOpen = signal(false);

  /** The board whose move menu is open, and the one being dragged (to a room in the sidebar). */
  protected readonly moveMenuFor = signal<string | null>(null);
  protected readonly draggingId = signal<string | null>(null);

  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');
  private readonly renameInput = viewChild<ElementRef<HTMLInputElement>>('renameInput');

  constructor() {
    this.#pageTitle.setTitle($localize`:@@boards.pageTitle:Boards · Elysion`);
    this.load();
    // The room's name is selected when it is being renamed.
    effect(() => {
      const field = this.renameInput()?.nativeElement;
      if (field) {
        untracked(() => {
          field.focus();
          field.select();
        });
      }
    });
    // Another view closes what belonged to the last one.
    effect(() => {
      this.roomId();
      untracked(() => {
        this.renaming.set(false);
        this.roomDeleteTarget.set(null);
        this.shareRoomOpen.set(false);
        this.moveMenuFor.set(null);
        this.roomError.set(null);
      });
    });
    // Put the cursor in the name field, with the default selected, when the form opens.
    effect(() => {
      const field = this.nameInput()?.nativeElement;
      if (field) {
        untracked(() => {
          field.focus();
          field.select();
        });
      }
    });
  }

  protected load(): void {
    this.state.set('loading');
    this.#api.list().subscribe({
      next: (boards) => {
        this.boards.set(boards);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
    this.loadRooms();
  }

  protected loadRooms(): void {
    this.roomsState.set('loading');
    this.#roomApi.list().subscribe({
      next: (rooms) => {
        this.rooms.set(rooms);
        this.roomsState.set('ready');
      },
      error: () => this.roomsState.set('error'),
    });
  }

  protected openCreate(): void {
    if (this.createState() !== 'closed') {
      return;
    }
    this.#createOpener = document.activeElement;
    this.draftName.set(DEFAULT_NEW_BOARD_NAME);
    this.createError.set(null);
    this.selectedTemplateId.set(null);
    this.createState.set('editing');
    if (this.templates().length === 0) {
      // A catalog that cannot be loaded only takes the choice away: a blank board is always possible.
      this.#templateApi.list().subscribe({
        next: (templates) => this.templates.set(templates),
        error: () => this.templates.set([]),
      });
    }
  }

  protected selectTemplate(id: string | null): void {
    this.selectedTemplateId.set(id);
  }

  protected cancelCreate(): void {
    if (this.createState() !== 'saving') {
      this.createState.set('closed');
      // The button that opened the dialog gets the focus back (WCAG 2.4.3).
      if (this.#createOpener instanceof HTMLElement && this.#createOpener.isConnected) {
        this.#createOpener.focus();
      }
    }
  }

  /** A click on the dimmed area around the dialog (not one inside it) closes the form. */
  protected closeOnBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.cancelCreate();
    }
  }

  protected updateName(event: Event): void {
    this.draftName.set((event.target as HTMLInputElement).value);
    this.createError.set(null);
  }

  protected create(): void {
    if (this.createState() !== 'editing') {
      return;
    }
    const name = this.draftName().trim();
    if (!name) {
      this.createError.set($localize`:@@boards.error.nameRequired:Give the board a name.`);
      return;
    }
    if (name.length > MAX_BOARD_NAME_LENGTH) {
      this.createError.set(
        $localize`:@@boards.error.nameLength:The name can have up to ${MAX_BOARD_NAME_LENGTH}:max: characters.`,
      );
      return;
    }

    this.createState.set('saving');
    this.#api.create(name).subscribe({
      next: (board) => {
        // A board made in a room view goes into that room before it is opened (two calls: the board first).
        const room = this.currentRoom();
        if (!room) {
          this.#open(board);
          return;
        }
        this.#api.moveToRoom(board.id, room.id).subscribe({
          next: (moved) => this.#open(moved),
          error: (error: unknown) => {
            this.createState.set('closed');
            this.roomError.set(
              $localize`:@@boards.error.created:The board “${board.name}:board:” was created, but could not be put in the room “${room.name}:room:”.` +
                ' ' +
                describeError(
                  error,
                  $localize`:@@boards.error.createdFallback:Move it from its card.`,
                  'room',
                ),
            );
            this.load();
          },
        });
      },
      error: () => {
        this.createState.set('editing');
        this.createError.set(
          $localize`:@@boards.error.create:The board could not be created. Try again.`,
        );
      },
    });
  }

  /** Opens a board the user just made; the template chosen in the form travels in the history state. */
  #open(board: BoardInfo): void {
    // The board page applies the template once it is connected (see Board).
    const templateId = this.selectedTemplateId();
    void (templateId
      ? this.#router.navigateByUrl(board.path, { state: { [TEMPLATE_STATE_KEY]: templateId } })
      : this.#router.navigateByUrl(board.path));
  }

  /** Copies the board with its content and opens the copy. */
  protected duplicate(board: BoardInfo): void {
    if (this.duplicatingId()) {
      return;
    }
    this.duplicateError.set(null);
    this.duplicatingId.set(board.id);
    this.#api.duplicate(board.id).subscribe({
      next: (copy) => {
        this.duplicatingId.set(null);
        void this.#router.navigateByUrl(copy.path);
      },
      error: () => {
        this.duplicatingId.set(null);
        this.duplicateError.set(
          $localize`:@@boards.error.duplicate:The board “${board.name}:board:” could not be duplicated. Try again.`,
        );
      },
    });
  }

  protected askDelete(board: BoardInfo): void {
    this.deleteError.set(null);
    this.deleteTarget.set(board);
  }

  protected cancelDelete(): void {
    if (!this.deleting()) {
      this.deleteTarget.set(null);
    }
  }

  protected confirmDelete(): void {
    const board = this.deleteTarget();
    if (!board || this.deleting()) {
      return;
    }
    this.deleting.set(true);
    this.#api.delete(board.id).subscribe({
      next: () => {
        this.boards.update((boards) => boards.filter((b) => b.id !== board.id));
        this.deleting.set(false);
        this.deleteTarget.set(null);
      },
      error: () => {
        this.deleting.set(false);
        this.deleteError.set(
          $localize`:@@boards.error.delete:The board could not be deleted. Try again.`,
        );
      },
    });
  }

  /** The name of the room a board is in, for the label on its card in the all-boards view. */
  protected roomLabel(board: BoardInfo): string | null {
    if (this.view() !== 'all' || board.roomId === null) {
      return null;
    }
    return this.rooms().find((room) => room.id === board.roomId)?.name ?? null;
  }

  protected countIn(room: RoomInfo): number {
    return this.roomCounts()[room.id] ?? 0;
  }

  protected onRoomAdded(room: RoomInfo): void {
    this.rooms.update((rooms) =>
      [...rooms, room].sort(
        (a, b) => a.name.localeCompare(b.name) || a.createdAt.localeCompare(b.createdAt),
      ),
    );
    void this.#router.navigate(['/rooms', room.id]);
  }

  protected startRename(room: RoomInfo): void {
    this.roomError.set(null);
    this.renameDraft.set(room.name);
    this.renaming.set(true);
  }

  protected cancelRename(): void {
    if (!this.renameSaving()) {
      this.renaming.set(false);
    }
  }

  protected updateRenameDraft(event: Event): void {
    this.renameDraft.set((event.target as HTMLInputElement).value);
  }

  protected saveRename(): void {
    const room = this.currentRoom();
    if (!room || this.renameSaving()) {
      return;
    }
    const name = this.renameDraft().trim();
    if (!name) {
      this.roomError.set($localize`:@@boards.error.roomName:A room needs a name.`);
      return;
    }
    if (name === room.name) {
      this.renaming.set(false);
      return;
    }
    this.roomError.set(null);
    this.renameSaving.set(true);
    this.#roomApi.rename(room.id, name).subscribe({
      next: (renamed) => {
        this.rooms.update((rooms) => rooms.map((r) => (r.id === renamed.id ? renamed : r)));
        this.renameSaving.set(false);
        this.renaming.set(false);
      },
      error: (error: unknown) => {
        this.renameSaving.set(false);
        this.roomError.set(
          describeError(
            error,
            $localize`:@@boards.error.rename:The room could not be renamed.`,
            'room',
          ),
        );
      },
    });
  }

  protected askDeleteRoom(room: RoomInfo): void {
    this.roomDeleteError.set(null);
    this.roomDeleteTarget.set(room);
  }

  protected cancelDeleteRoom(): void {
    if (!this.roomDeleting()) {
      this.roomDeleteTarget.set(null);
    }
  }

  /** The room goes, its boards stay and are in no room any more; the list goes back to all boards. */
  protected confirmDeleteRoom(): void {
    const room = this.roomDeleteTarget();
    if (!room || this.roomDeleting()) {
      return;
    }
    this.roomDeleting.set(true);
    this.#roomApi.delete(room.id).subscribe({
      next: () => {
        this.rooms.update((rooms) => rooms.filter((r) => r.id !== room.id));
        this.boards.update((boards) =>
          boards.map((board) => (board.roomId === room.id ? { ...board, roomId: null } : board)),
        );
        this.roomDeleting.set(false);
        this.roomDeleteTarget.set(null);
        void this.#router.navigateByUrl('/');
      },
      error: (error: unknown) => {
        this.roomDeleting.set(false);
        this.roomDeleteError.set(
          describeError(
            error,
            $localize`:@@boards.error.roomDelete:The room could not be deleted. Try again.`,
            'room',
          ),
        );
      },
    });
  }

  protected roomTitle(label: string): string {
    return $localize`:@@boards.card.room.title:In the room ${label}:room:`;
  }

  protected moveLabel(board: BoardInfo): string {
    return $localize`:@@boards.card.move.aria:Move the board ${board.name}:board: to a room`;
  }

  protected duplicateLabel(board: BoardInfo): string {
    return $localize`:@@boards.card.duplicate.aria:Duplicate the board ${board.name}:board:`;
  }

  protected duplicateTitle(board: BoardInfo): string {
    return this.duplicatingId() === board.id
      ? $localize`:@@boards.card.duplicating:Duplicating…`
      : $localize`:@@boards.card.duplicate.title:Duplicate this board`;
  }

  protected deleteLabel(board: BoardInfo): string {
    return $localize`:@@boards.card.delete.aria:Delete the board ${board.name}:board:`;
  }

  /** The ways to move a board from here: into each room the user may write in, or out of its room. */
  protected moveOptions(board: BoardInfo): MoveOption[] {
    const options: MoveOption[] = this.rooms()
      .filter((room) => canWriteInRoom(room) && room.id !== board.roomId)
      .map((room) => ({
        roomId: room.id,
        label: $localize`:@@boards.move.to:Move to ${room.name}:room:`,
      }));
    if (board.roomId !== null) {
      options.push({ roomId: null, label: $localize`:@@boards.move.remove:Remove from room` });
    }
    return options;
  }

  /** Whether the card can be dragged to the sidebar: there is somewhere to move it. */
  protected canMove(board: BoardInfo): boolean {
    return this.moveOptions(board).length > 0;
  }

  protected toggleMoveMenu(board: BoardInfo): void {
    this.moveMenuFor.update((open) => (open === board.id ? null : board.id));
  }

  protected closeMoveMenu(): void {
    this.moveMenuFor.set(null);
  }

  /** A click outside the open menu closes it. */
  @HostListener('document:click', ['$event'])
  protected closeMoveMenuOnOutsideClick(event: Event): void {
    if (this.moveMenuFor() !== null && !(event.target as Element | null)?.closest('.move-root')) {
      this.moveMenuFor.set(null);
    }
  }

  /** Puts the board in the room, or takes it out (`null`); the answer replaces the board in the list. */
  protected moveTo(board: BoardInfo, roomId: string | null): void {
    this.moveMenuFor.set(null);
    this.roomError.set(null);
    if (board.roomId === roomId) {
      return;
    }
    this.#api.moveToRoom(board.id, roomId).subscribe({
      next: (moved) =>
        this.boards.update((boards) => boards.map((b) => (b.id === moved.id ? moved : b))),
      error: (error: unknown) =>
        this.roomError.set(
          $localize`:@@boards.error.move:The board “${board.name}:board:” could not be moved.` +
            ' ' +
            describeError(error, $localize`:@@boards.error.moveFallback:Try again.`, 'room'),
        ),
    });
  }

  protected dragStart(board: BoardInfo, event: DragEvent): void {
    if (!this.canMove(board)) {
      event.preventDefault();
      return;
    }
    this.moveMenuFor.set(null);
    this.draggingId.set(board.id);
    event.dataTransfer?.setData('text/plain', board.id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  protected dragEnd(): void {
    this.draggingId.set(null);
  }

  /** A board dropped on a room in the sidebar, or on "Not in a room" (`null`). */
  protected onBoardDropped(roomId: string | null): void {
    const board = this.boards().find((b) => b.id === this.draggingId());
    this.draggingId.set(null);
    if (board) {
      this.moveTo(board, roomId);
    }
  }
}
