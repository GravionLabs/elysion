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
import { RoomPdfExporter } from './room-pdf-export';
import { downloadBlob, exportFilename } from '../board/download';
import { loadSettings } from '../topbar/export-settings';
import { BOARD_SORTS, BoardSort, loadSort, saveSort } from './list-preferences';

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

/** Newest first by default; `opened` puts the boards never opened last; in the all-boards view the starred ones come first. */
export function sortBoards(
  boards: readonly BoardInfo[],
  sort: BoardSort,
  favoritesFirst: boolean,
): BoardInfo[] {
  const byNewest = (a: BoardInfo, b: BoardInfo) => b.createdAt.localeCompare(a.createdAt);
  const order: Record<BoardSort, (a: BoardInfo, b: BoardInfo) => number> = {
    newest: byNewest,
    name: (a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || byNewest(a, b),
    opened: (a, b) => (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? '') || byNewest(a, b),
  };
  return [...boards].sort((a, b) => {
    if (favoritesFirst && (a.isFavorite === true) !== (b.isFavorite === true)) {
      return a.isFavorite === true ? -1 : 1;
    }
    return order[sort](a, b);
  });
}

export const DEFAULT_NEW_BOARD_NAME = $localize`:@@boards.defaultName:Untitled board`;

type ListState = 'loading' | 'ready' | 'error';

/** A room with more boards than this asks before it is exported: each board takes a few seconds. */
const LARGE_ROOM_BOARDS = 20;

/** Where the export of a room is (#727). */
export type RoomExportState =
  | { phase: 'confirm'; room: RoomInfo; count: number; minutes: number }
  | { phase: 'running'; room: RoomInfo; done: number; total: number; current: string }
  | { phase: 'done'; room: RoomInfo; skipped: string[] }
  | { phase: 'failed'; room: RoomInfo };
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
  readonly #roomExporter = inject(RoomPdfExporter);

  /** The view, from the route: `undefined` for all boards, `none` for boards in no room, `favorites` for the starred ones, else a room's id. */
  readonly roomId = input<string | undefined>();

  /** The search, from `?q=` of the route (#730); typing in the field writes it back, so a search can be linked and reloaded. */
  readonly q = input<string | undefined>();

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

  protected readonly view = computed<'all' | 'none' | 'favorites' | 'room'>(() => {
    const id = this.roomId();
    return id === undefined ? 'all' : id === 'none' || id === 'favorites' ? id : 'room';
  });

  /** What the search field holds; boards whose name does not contain it (ignoring case) are hidden. */
  protected readonly search = signal('');
  protected readonly sort = signal<BoardSort>(loadSort());
  protected readonly sortChoices = BOARD_SORTS;
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

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
      case 'favorites':
        return $localize`:@@boards.sidebar.favorites:Favorites`;
      default:
        return (
          this.currentRoom()?.name ??
          (this.roomMissing()
            ? $localize`:@@boards.roomMissing.title:Room not found`
            : $localize`:@@boards.title.room:Room`)
        );
    }
  });

  /** The boards of the view, before the search narrows them. */
  readonly #inView = computed(() => {
    const boards = this.boards();
    switch (this.view()) {
      case 'all':
        return boards;
      case 'none':
        return boards.filter((board) => board.roomId === null);
      case 'favorites':
        return boards.filter((board) => board.isFavorite === true);
      default:
        return boards.filter((board) => board.roomId === this.roomId());
    }
  });

  protected readonly visibleBoards = computed(() => {
    const needle = this.search().trim().toLowerCase();
    const found = needle
      ? this.#inView().filter((board) => board.name.toLowerCase().includes(needle))
      : this.#inView();
    return sortBoards(found, this.sort(), this.view() === 'all');
  });

  /** Whether a search is narrowing the view. */
  protected readonly searching = computed(() => this.search().trim() !== '');

  protected readonly favoriteCount = computed(
    () => this.boards().filter((board) => board.isFavorite === true).length,
  );

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

  /**
   * The export of a room as one PDF (#727): asking first when the room is large, then the progress with a way to cancel. `null`
   * when nothing is going on.
   */
  protected readonly roomExport = signal<RoomExportState | null>(null);
  #roomExportAbort: AbortController | null = null;

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
    // The address holds the search: arriving with `?q=` (or the back button) fills the field.
    effect(() => this.search.set(this.q() ?? ''));
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

  protected updateSearch(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.search.set(value);
    void this.#router.navigate([], {
      queryParams: { q: value.trim() || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected clearSearch(): void {
    this.search.set('');
    void this.#router.navigate([], {
      queryParams: { q: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    this.searchInput()?.nativeElement.focus();
  }

  protected chooseSort(event: Event): void {
    const sort = (event.target as HTMLSelectElement).value as BoardSort;
    if (BOARD_SORTS.includes(sort)) {
      this.sort.set(sort);
      saveSort(sort);
    }
  }

  protected sortLabel(sort: BoardSort): string {
    switch (sort) {
      case 'name':
        return $localize`:@@boards.sort.name:Name`;
      case 'opened':
        return $localize`:@@boards.sort.opened:Last opened`;
      default:
        return $localize`:@@boards.sort.newest:Newest`;
    }
  }

  /** `/` jumps to the search, unless the user is typing somewhere. */
  @HostListener('document:keydown', ['$event'])
  protected focusSearchOnSlash(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const typing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target?.isContentEditable === true;
    if (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const field = this.searchInput()?.nativeElement;
      if (field) {
        event.preventDefault();
        field.focus();
        field.select();
      }
    }
  }

  /** Stars the board, or takes the star away: shown at once, undone when saving fails. */
  protected toggleFavorite(board: BoardInfo): void {
    const favorite = board.isFavorite !== true;
    const set = (value: boolean) =>
      this.boards.update((boards) =>
        boards.map((b) => (b.id === board.id ? { ...b, isFavorite: value } : b)),
      );
    set(favorite);
    this.#api.setFavorite(board.id, favorite).subscribe({
      error: () => {
        set(!favorite);
        this.roomError.set(
          $localize`:@@boards.error.favorite:The star of the board “${board.name}:board:” could not be saved. Try again.`,
        );
      },
    });
  }

  protected favoriteLabel(board: BoardInfo): string {
    return board.isFavorite
      ? $localize`:@@boards.card.unfavorite.aria:Remove the board ${board.name}:board: from the favorites`
      : $localize`:@@boards.card.favorite.aria:Add the board ${board.name}:board: to the favorites`;
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

  /** The Export room button: a room of more than 20 boards asks first and says how long it may take. */
  protected askExportRoom(room: RoomInfo): void {
    const count = this.visibleBoards().length;
    if (count > LARGE_ROOM_BOARDS) {
      this.roomExport.set({ phase: 'confirm', room, count, minutes: Math.ceil((count * 5) / 60) });
      return;
    }
    void this.startExportRoom(room);
  }

  protected async startExportRoom(room: RoomInfo): Promise<void> {
    const boards = this.visibleBoards().map((board) => ({ id: board.id, name: board.name }));
    const abort = new AbortController();
    this.#roomExportAbort = abort;
    this.roomExport.set({
      phase: 'running',
      room,
      done: 0,
      total: boards.length,
      current: boards[0]?.name ?? '',
    });
    try {
      const { pdf, skipped } = await this.#roomExporter.export(boards, loadSettings(), {
        signal: abort.signal,
        onProgress: ({ done, total, current }) =>
          this.roomExport.set({ phase: 'running', room, done, total, current }),
        texts: {
          board: (index, total) =>
            $localize`:@@boards.roomExport.board:Board ${index}:index: of ${total}:total:`,
          unreadable: $localize`:@@boards.roomExport.unreadable:This board could not be loaded and is not in the PDF.`,
          empty: $localize`:@@boards.roomExport.empty:This board is empty.`,
        },
      });
      if (pdf === null) {
        this.roomExport.set(null);
        return;
      }
      downloadBlob(pdf, exportFilename(room.name, room.id, 'pdf', false));
      this.roomExport.set(skipped.length > 0 ? { phase: 'done', room, skipped } : null);
    } catch {
      this.roomExport.set({ phase: 'failed', room });
    } finally {
      this.#roomExportAbort = null;
    }
  }

  protected cancelExportRoom(): void {
    this.#roomExportAbort?.abort();
    this.roomExport.set(null);
  }
}
