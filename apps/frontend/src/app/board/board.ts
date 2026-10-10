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
import { FilesApi } from './files-api';
import { ShareDialog } from '../share/share-dialog';
import { CanvasElement } from './canvas-element';
import { downloadBlob, exportFilename, type ExportFormat } from './download';
import { ExportRequest } from '../topbar/export-menu';
import { toCanvasOptions } from '../topbar/export-settings';
import { CANVAS_ELEMENT_SRC, CanvasElementLoader } from './canvas-element-loader';
import { SessionService } from '../auth/session.service';
import { LanguageService } from '../shared/language';
import { PresenceStore } from './presence-store';
import type { TimerState, VotingSession } from './canvas-element';
import { TEMPLATE_STATE_KEY, TemplateApi } from './template-api';

/** What the user is typing into the Save as template form. */
export interface TemplateDraft {
  selectionOnly: boolean;
  name: string;
  description: string;
  saving: boolean;
  /** Why the last attempt failed, shown in the form. */
  error?: string;
}

const MAX_TEMPLATE_NAME_LENGTH = 120;
const MAX_TEMPLATE_DESCRIPTION_LENGTH = 500;

export type CanvasStatus = 'loading' | 'ready' | 'error';

const CANVAS_NOT_READY = $localize`:@@board.error.canvasNotReady:The canvas is not ready yet.`;

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
  readonly #files = inject(FilesApi);
  readonly #pageTitle = inject(Title);
  readonly #templates = inject(TemplateApi);
  readonly #location = inject(Location);
  protected readonly language = inject(LanguageService);
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

  /** The board's shared timer from the canvas's `timer` event (ADR 0020), or `null`. */
  readonly timer = signal<TimerState | null>(null);

  /** The board's current dot voting from the canvas's `voting` event (ADR 0020), or `null`. */
  readonly voting = signal<VotingSession | null>(null);

  /** An export is being prepared: a PDF of a large board takes seconds, so the Export menu says so. */
  readonly exporting = signal<ExportFormat | null>(null);

  /** A file chosen for import that waits for the user's confirmation. */
  readonly pendingImport = signal<File | null>(null);

  /** The Save as template form; `null` while it is closed. */
  readonly templateDraft = signal<TemplateDraft | null>(null);
  protected readonly maxTemplateNameLength = MAX_TEMPLATE_NAME_LENGTH;
  protected readonly maxTemplateDescriptionLength = MAX_TEMPLATE_DESCRIPTION_LENGTH;

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
        this.notFound()
          ? $localize`:@@board.pageTitle.notFound:Board not found · Elysion`
          : name
            ? $localize`:@@board.pageTitle.named:${name}:name: · Elysion`
            : 'Elysion',
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
        throw new Error(CANVAS_NOT_READY);
      }
      await canvas.importFile(new Blob([template.scene], { type: 'application/json' }));
    } catch {
      this.notice.set(
        $localize`:@@board.error.templateNotApplied:The template could not be applied. The board is blank.`,
      );
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
        this.notice.set($localize`:@@board.error.renameFailed:The board could not be renamed.`);
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
        this.notice.set(
          $localize`:@@board.error.accessLost:You no longer have access to this board.`,
        );
        return null;
      }
      throw error;
    }
  };

  /** The images of this board are kept by the BFF (#702); the canvas uploads and loads through this. */
  protected readonly fileStore = this.#files.storeFor(() => this.boardId());

  /**
   * Whether images may be inserted: only on a stored board, because the files belong to a board record (the room
   * `default` has none, so its images would have nowhere to go).
   */
  protected readonly imagesEnabled = computed(() => isStoredBoardId(this.boardId()));

  /** An image could not be stored or loaded; the canvas has taken an unsaved one off the board again. */
  onFileError(event: Event): void {
    this.notice.set((event as CustomEvent<{ message: string }>).detail.message);
  }

  /**
   * Something the canvas wants the person to know that is not a failure of the board: it is full, a change was too
   * large to send, a library was refused. The banner says it; the board stays as it is.
   */
  onCanvasNotice(event: Event): void {
    this.notice.set((event as CustomEvent<{ message: string }>).detail.message);
  }

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

  onVoting(event: Event): void {
    this.voting.set((event as CustomEvent<{ session: VotingSession | null }>).detail.session);
  }

  onTimer(event: Event): void {
    this.timer.set((event as CustomEvent<{ state: TimerState | null }>).detail.state);
  }

  /** Asks the canvas to change the shared timer or voting; a refusal (read-only, not ready) is shown in the banner. */
  async timerCommand(run: (canvas: CanvasElement) => Promise<void> | undefined): Promise<void> {
    const canvas = this.canvas()?.nativeElement;
    const call = canvas ? run(canvas) : undefined;
    if (!call) {
      this.notice.set(CANVAS_NOT_READY);
      return;
    }
    try {
      await call;
    } catch (error) {
      this.notice.set(
        error instanceof Error
          ? error.message
          : $localize`:@@board.error.timerFailed:The timer could not be changed.`,
      );
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
      this.notice.set(CANVAS_NOT_READY);
      return;
    }
    this.exporting.set(request.format);
    try {
      const blob = await canvas.exportBoard(
        request.format,
        toCanvasOptions(request.settings, request.selectionOnly),
      );
      if (!blob) {
        this.notice.set(
          request.selectionOnly
            ? $localize`:@@board.error.nothingSelected:Nothing is selected.`
            : $localize`:@@board.error.exportEmpty:The board is empty: there is nothing to export.`,
        );
        return;
      }
      downloadBlob(
        blob,
        exportFilename(this.boardName(), this.boardId(), request.format, request.selectionOnly),
      );
      this.notice.set(null);
    } catch {
      this.notice.set($localize`:@@board.error.exportFailed:The export failed.`);
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
      this.notice.set(CANVAS_NOT_READY);
      return;
    }
    try {
      const count = await canvas.importFile(file);
      this.notice.set(
        count === 1
          ? $localize`:@@board.notice.imported.one:Imported 1 element from ${file.name}:file:.`
          : $localize`:@@board.notice.imported.many:Imported ${count}:count: elements from ${file.name}:file:.`,
      );
    } catch (error) {
      this.notice.set(
        error instanceof Error
          ? error.message
          : $localize`:@@board.error.importFailed:The import failed.`,
      );
    }
  }

  /** The user chose a template in the top bar: it is added next to what is on the board, selected. */
  async addTemplate(templateId: string): Promise<void> {
    const canvas = this.canvas()?.nativeElement;
    if (!canvas?.insertFile) {
      this.notice.set(CANVAS_NOT_READY);
      return;
    }
    try {
      const template = await firstValueFrom(this.#templates.get(templateId));
      await canvas.insertFile(new Blob([template.scene], { type: 'application/json' }));
      this.notice.set(null);
    } catch (error) {
      this.notice.set(
        error instanceof Error && error.message !== CANVAS_NOT_READY
          ? error.message
          : $localize`:@@board.error.templateAddFailed:The template could not be added.`,
      );
    }
  }

  /** Opens the form to save the board, or the selection, as a template; the name starts as the board's. */
  startSaveTemplate(selectionOnly: boolean): void {
    this.notice.set(null);
    this.templateDraft.set({
      selectionOnly,
      name: selectionOnly
        ? $localize`:@@board.template.defaultSelectionName:Selection`
        : (this.boardName() ?? $localize`:@@board.template.defaultBoardName:Board`),
      description: '',
      saving: false,
    });
  }

  updateTemplateDraft(field: 'name' | 'description', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.templateDraft.update((draft) =>
      draft ? { ...draft, [field]: value, error: undefined } : draft,
    );
  }

  cancelSaveTemplate(): void {
    if (!this.templateDraft()?.saving) {
      this.templateDraft.set(null);
    }
  }

  /** Exports the board (or the selection) as an .excalidraw file and stores it as the user's own template. */
  async saveTemplate(): Promise<void> {
    const draft = this.templateDraft();
    if (!draft || draft.saving) {
      return;
    }
    const name = draft.name.trim();
    if (!name) {
      this.templateDraft.set({
        ...draft,
        error: $localize`:@@board.template.nameRequired:Give the template a name.`,
      });
      return;
    }
    const canvas = this.canvas()?.nativeElement;
    if (!canvas?.exportBoard) {
      this.templateDraft.set(null);
      this.notice.set(CANVAS_NOT_READY);
      return;
    }
    this.templateDraft.set({ ...draft, saving: true, error: undefined });
    try {
      const blob = await canvas.exportBoard('excalidraw', { selectionOnly: draft.selectionOnly });
      if (!blob) {
        this.notice.set(
          draft.selectionOnly
            ? $localize`:@@board.error.nothingSelected:Nothing is selected.`
            : $localize`:@@board.error.templateEmpty:The board is empty: there is nothing to save as a template.`,
        );
      } else {
        await firstValueFrom(
          this.#templates.create({
            name,
            description: draft.description.trim(),
            scene: await blob.text(),
          }),
        );
        this.notice.set(
          $localize`:@@board.notice.templateSaved:Saved the template “${name}:name:”.`,
        );
      }
      this.templateDraft.set(null);
    } catch {
      // The form stays open with what the user typed, so a retry is one click.
      this.templateDraft.update((current) =>
        current
          ? {
              ...current,
              saving: false,
              error: $localize`:@@board.error.templateSaveFailed:The template could not be saved.`,
            }
          : current,
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
