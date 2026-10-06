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
import { Location } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Title } from '@angular/platform-browser';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom, startWith, switchMap } from 'rxjs';
import { Theme, ThemeService } from '../theme/theme.service';
import { SyncStatus, TopBar } from '../topbar/top-bar';
import { RouterLink } from '@angular/router';
import { AppBrand } from '../shared/app-brand';
import { BoardApi, BoardLookup, BoardRole, isStoredBoardId } from './board-api';
import { ShareDialog } from '../share/share-dialog';
import { CanvasElement } from './canvas-element';
import { downloadBlob, exportFilename, type ExportFormat } from './download';
import { ExportRequest } from '../topbar/export-menu';
import { CANVAS_ELEMENT_SRC, CanvasElementLoader } from './canvas-element-loader';
import { SessionService } from '../auth/session.service';
import { PresenceStore } from './presence-store';
import { TEMPLATE_STATE_KEY, TemplateApi } from './template-api';

export type CanvasStatus = 'loading' | 'ready' | 'error';

const PENDING: BoardLookup | { status: 'pending' } = { status: 'pending' };

/** The role is being asked for. */
const ROLE_PENDING = 'pending';

/** The board page: the top bar and the canvas element below it. */
@Component({
  imports: [AppBrand, RouterLink, ShareDialog, TopBar],
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
  readonly #templates = inject(TemplateApi);
  readonly #location = inject(Location);
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

  /** The user's role on this board, as the BFF says; `pending` until it answers. */
  readonly #roleLookup = toSignal(
    toObservable(this.boardId).pipe(
      switchMap((id) =>
        this.#api
          .myRole(id)
          .pipe(startWith(ROLE_PENDING as BoardRole | typeof ROLE_PENDING | null)),
      ),
    ),
    { initialValue: ROLE_PENDING as BoardRole | typeof ROLE_PENDING | null },
  );

  /** The user's role, or `null` while it loads and for a room without a board record. */
  readonly role = computed(() => {
    const role = this.#roleLookup();
    return role === ROLE_PENDING ? null : role;
  });

  /** An owner may share the board. */
  readonly canShare = computed(() => this.role() === 'owner');

  /** A viewer sees the board but cannot change it: the canvas is read-only and the top bar hides what changes it. */
  readonly readOnly = computed(() => this.role() === 'viewer');

  /** Whether the Share dialog is open. */
  readonly shareOpen = signal(false);

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
      !this.notFound() &&
      // Not before the role is known, so a viewer's canvas never starts as an editor's.
      !(
        isStoredBoardId(this.boardId()) &&
        (this.#lookup().status === 'pending' || this.#roleLookup() === ROLE_PENDING)
      ),
  );

  /** A name the user just gave the board, shown at once (and rolled back if saving fails). */
  readonly #renamedTo = signal<string | null>(null);

  /** The board's name, or `null` while it loads and for a room without a stored board. */
  readonly boardName = computed(() => this.#renamedTo() ?? this.#loadedName());

  /**
   * The template the user chose when creating this board, until it is applied. It comes from the history state of
   * the navigation that opened the board: only the creator has it, so the content is written by one browser, and
   * everybody else (also a second window opening the board) receives it through the sync like any other content.
   * It is dropped from the history once applied, so a reload does not apply it again.
   */
  readonly #pendingTemplateId = signal<string | null>(this.#templateFromHistory());

  constructor() {
    this.#loader.load(this.#canvasElementSrc).catch(() => this.status.set('error'));
    // Another board in the same page starts without the previous one's new name.
    effect(() => {
      this.boardId();
      untracked(() => this.#renamedTo.set(null));
    });
    // Apply the template once the canvas is connected; the creator is an owner, so a viewer never gets here.
    effect(() => {
      const templateId = this.#pendingTemplateId();
      if (
        templateId &&
        isStoredBoardId(this.boardId()) &&
        this.status() === 'ready' &&
        this.syncStatus() === 'connected' &&
        !this.readOnly()
      ) {
        untracked(() => void this.#applyTemplate(templateId));
      }
    });
    effect(() => {
      const name = this.boardName();
      this.#pageTitle.setTitle(
        this.notFound() ? 'Board not found · Elysion' : name ? `${name} · Elysion` : 'Elysion',
      );
    });
  }

  #templateFromHistory(): string | null {
    const id = (this.#location.getState() as Record<string, unknown> | null)?.[TEMPLATE_STATE_KEY];
    return typeof id === 'string' ? id : null;
  }

  /**
   * Writes the template into the canvas, once: the marker goes first (signal and history), so neither a second
   * event nor a reload applies it again. Applying twice would also not duplicate anything, because the elements
   * keep their ids, but it would reset them. A failure is told and not retried: the board is simply blank.
   */
  async #applyTemplate(templateId: string): Promise<void> {
    this.#pendingTemplateId.set(null);
    this.#location.replaceState(this.#location.path(), '', {
      ...(this.#location.getState() as object),
      [TEMPLATE_STATE_KEY]: undefined,
    });
    try {
      const template = await firstValueFrom(this.#templates.get(templateId));
      const canvas = this.canvas()?.nativeElement;
      if (!canvas?.importFile) {
        throw new Error('The canvas is not ready yet.');
      }
      await canvas.importFile(new Blob([template.scene], { type: 'application/json' }));
    } catch {
      this.notice.set('The template could not be applied. The board is blank.');
    }
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

  /** The user chose a template in the top bar: it is added next to what is on the board, selected. */
  async addTemplate(templateId: string): Promise<void> {
    const canvas = this.canvas()?.nativeElement;
    if (!canvas?.insertFile) {
      this.notice.set('The canvas is not ready yet.');
      return;
    }
    try {
      const template = await firstValueFrom(this.#templates.get(templateId));
      await canvas.insertFile(new Blob([template.scene], { type: 'application/json' }));
      this.notice.set(null);
    } catch (error) {
      this.notice.set(
        error instanceof Error && error.message !== 'The canvas is not ready yet.'
          ? error.message
          : 'The template could not be added.',
      );
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

  openShare(): void {
    this.shareOpen.set(true);
  }

  closeShare(): void {
    this.shareOpen.set(false);
  }

  logout(): void {
    this.session.logout();
  }

  toggleTheme(): void {
    this.#themeService.toggle();
  }
}
