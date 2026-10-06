import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Title } from '@angular/platform-browser';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom, startWith, switchMap } from 'rxjs';
import { Theme, ThemeService } from '../theme/theme.service';
import { SyncStatus, TopBar } from '../topbar/top-bar';
import { RouterLink } from '@angular/router';
import { AppBrand } from '../shared/app-brand';
import { BoardApi, BoardLookup, isStoredBoardId } from './board-api';
import { CanvasElement } from './canvas-element';
import { downloadBlob, exportFilename, type ExportFormat } from './download';
import { ExportRequest } from '../topbar/export-menu';
import { CANVAS_ELEMENT_SRC, CanvasElementLoader } from './canvas-element-loader';
import { SessionService } from '../auth/session.service';
import { PresenceStore } from './presence-store';

export type CanvasStatus = 'loading' | 'ready' | 'error';

const PENDING: BoardLookup | { status: 'pending' } = { status: 'pending' };

/** The board page: the top bar and the canvas element below it. */
@Component({
  imports: [AppBrand, RouterLink, TopBar],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  providers: [PresenceStore],
  selector: 'app-board',
  styleUrl: './board.scss',
  templateUrl: './board.html',
})
export class Board {
  readonly #loader = inject(CanvasElementLoader);
  readonly #canvasElementSrc = inject(CANVAS_ELEMENT_SRC);
  readonly #themeService = inject(ThemeService);
  readonly #api = inject(BoardApi);
  readonly #pageTitle = inject(Title);
  protected readonly presence = inject(PresenceStore);
  protected readonly session = inject(SessionService);

  /** Passed to <elysion-canvas> as the `board-id` attribute. */
  readonly boardId = input('default');

  /** Passed to <elysion-canvas> as the `yjs-server-url` attribute; omitted (element uses its own same-origin default) when not set. */
  readonly yjsServerUrl = input<string>();

  /** The app-wide theme, passed to <elysion-canvas> as its `theme` attribute. */
  readonly theme = this.#themeService.theme;

  /** Whether the canvas script loaded and the element started. */
  readonly status = signal<CanvasStatus>('loading');

  /** The element, to call its methods. (`private`, not `#`: Angular's queries cannot be ES-private.) */
  private readonly canvas = viewChild<ElementRef<CanvasElement>>('canvas');

  /** Whether the library sidebar is open, from the element's `librarychange` event. */
  readonly libraryOpen = signal(false);

  /** How many elements are selected, from the element's `selectioncount` event. */
  readonly selectionCount = signal(0);

  /** A short message about the last export or import; `null` when there is none. */
  readonly notice = signal<string | null>(null);

  /** An export is being prepared: a PDF of a large board takes seconds, so the Export menu says so. */
  readonly exporting = signal<ExportFormat | null>(null);

  /** A file chosen for import that waits for the user's confirmation. */
  readonly pendingImport = signal<File | null>(null);

  /** The Yjs connection, from the element's `status` event. */
  readonly syncStatus = signal<SyncStatus>('connecting');

  /** What the BFF says about the board id; `pending` until it answers. */
  readonly #lookup = toSignal(
    toObservable(this.boardId).pipe(switchMap((id) => this.#api.find(id).pipe(startWith(PENDING)))),
    { initialValue: PENDING },
  );

  /** The board's name as loaded, or `null` while it loads and for a room without a stored board. */
  readonly #loadedName = computed(() => {
    const lookup = this.#lookup();
    return lookup.status === 'found' ? lookup.board.name : null;
  });

  /** The id belongs to no board: it never existed or the board was deleted. */
  readonly notFound = computed(() => this.#lookup().status === 'missing');

  /**
   * Whether to start the canvas. Not for a board that does not exist: connecting would create a room
   * (and, once something is drawn, a stored document) for it. A stored board's id waits for the answer.
   */
  readonly canvasVisible = computed(
    () =>
      !this.notFound() && !(this.#lookup().status === 'pending' && isStoredBoardId(this.boardId())),
  );

  /** A name the user just gave the board, shown at once (and rolled back if saving fails). */
  readonly #renamedTo = signal<string | null>(null);

  /** The board's name, or `null` while it loads and for a room without a stored board. */
  readonly boardName = computed(() => this.#renamedTo() ?? this.#loadedName());

  constructor() {
    this.#loader.load(this.#canvasElementSrc).catch(() => this.status.set('error'));
    // Another board in the same page starts without the previous one's new name.
    effect(() => {
      this.boardId();
      untracked(() => this.#renamedTo.set(null));
    });
    effect(() => {
      const name = this.boardName();
      this.#pageTitle.setTitle(
        this.notFound() ? 'Board not found · Elysion' : name ? `${name} · Elysion` : 'Elysion',
      );
    });
  }

  /** The user confirmed a new name in the top bar: show it at once, save it, undo it if saving fails. */
  rename(name: string): void {
    const before = this.#renamedTo();
    this.#renamedTo.set(name);
    this.#api.rename(this.boardId(), name).subscribe({
      next: (board) => this.#renamedTo.set(board.name),
      error: () => {
        this.#renamedTo.set(before);
        this.notice.set('The board could not be renamed.');
      },
    });
  }

  /**
   * What the canvas calls before every connection (a token lives for about a minute, so one per reconnect). No role
   * on the board is a 403: the user is told, and `null` makes the canvas stay disconnected instead of asking
   * again and again. Any other failure (the BFF is down) is passed on, and the canvas retries with a growing delay;
   * a 401 has already restarted the login (the interceptor).
   */
  protected readonly wsTokenProvider = async (): Promise<string | null> => {
    try {
      return (await firstValueFrom(this.#api.realtimeToken(this.boardId()))).token;
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 403) {
        this.notice.set('You no longer have access to this board.');
        return null;
      }
      throw error;
    }
  };

  onCanvasReady(): void {
    this.status.set('ready');
  }

  onCanvasError(): void {
    this.status.set('error');
  }

  onSyncStatus(event: Event): void {
    const { status } = (event as CustomEvent<{ status: SyncStatus }>).detail;
    this.syncStatus.set(status);
    if (status === 'connected' && this.status() === 'error') {
      // The canvas reports connection failures as `error` and keeps retrying: once it is connected again it is fine.
      this.status.set('ready');
    }
  }

  onPresence(event: Event): void {
    this.presence.setFromEvent((event as CustomEvent).detail);
  }

  /** The user switched the theme inside the canvas; it becomes the app's explicit choice. */
  onCanvasThemeChange(event: Event): void {
    this.#themeService.set((event as CustomEvent<{ theme: Theme }>).detail.theme);
  }

  onSelectionCount(event: Event): void {
    this.selectionCount.set((event as CustomEvent<{ count: number }>).detail.count);
  }

  async exportBoard(request: ExportRequest): Promise<void> {
    const canvas = this.canvas()?.nativeElement;
    if (!canvas?.exportBoard) {
      this.notice.set('The canvas is not ready yet.');
      return;
    }
    this.exporting.set(request.format);
    try {
      const blob = await canvas.exportBoard(request.format, {
        selectionOnly: request.selectionOnly,
      });
      if (!blob) {
        this.notice.set(
          request.selectionOnly
            ? 'Nothing is selected.'
            : 'The board is empty: there is nothing to export.',
        );
        return;
      }
      downloadBlob(
        blob,
        exportFilename(this.boardName(), this.boardId(), request.format, request.selectionOnly),
      );
      this.notice.set(null);
    } catch {
      this.notice.set('The export failed.');
    } finally {
      this.exporting.set(null);
    }
  }

  /** A file was picked: ask first, because an import replaces what is on the board. */
  chooseImport(file: File): void {
    this.notice.set(null);
    this.pendingImport.set(file);
  }

  cancelImport(): void {
    this.pendingImport.set(null);
  }

  async confirmImport(): Promise<void> {
    const file = this.pendingImport();
    this.pendingImport.set(null);
    const canvas = this.canvas()?.nativeElement;
    if (!file || !canvas?.importFile) {
      this.notice.set('The canvas is not ready yet.');
      return;
    }
    try {
      const count = await canvas.importFile(file);
      this.notice.set(
        `Imported ${count} ${count === 1 ? 'element' : 'elements'} from ${file.name}.`,
      );
    } catch (error) {
      this.notice.set(error instanceof Error ? error.message : 'The import failed.');
    }
  }

  dismissNotice(): void {
    this.notice.set(null);
  }

  onLibraryChange(event: Event): void {
    this.libraryOpen.set((event as CustomEvent<{ open: boolean }>).detail.open);
  }

  toggleLibrary(): void {
    this.canvas()?.nativeElement.toggleLibrary?.();
  }

  logout(): void {
    this.session.logout();
  }

  toggleTheme(): void {
    this.#themeService.toggle();
  }
}
