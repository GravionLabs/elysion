import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { map, switchMap } from 'rxjs';
import { Theme, ThemeService } from '../theme/theme.service';
import { SyncStatus, TopBar } from '../topbar/top-bar';
import { BoardApi } from './board-api';
import { CanvasElement } from './canvas-element';
import { downloadBlob, exportFilename } from './download';
import { ExportRequest } from '../topbar/export-menu';
import { CANVAS_ELEMENT_SRC, CanvasElementLoader } from './canvas-element-loader';

export type CanvasStatus = 'loading' | 'ready' | 'error';

/** The board page: the top bar and the canvas element below it. */
@Component({
  imports: [TopBar],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  selector: 'app-board',
  styleUrl: './board.scss',
  templateUrl: './board.html',
})
export class Board {
  readonly #loader = inject(CanvasElementLoader);
  readonly #canvasElementSrc = inject(CANVAS_ELEMENT_SRC);
  readonly #themeService = inject(ThemeService);
  readonly #api = inject(BoardApi);

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

  /** A file chosen for import that waits for the user's confirmation. */
  readonly pendingImport = signal<File | null>(null);

  /** The Yjs connection, from the element's `status` event. */
  readonly syncStatus = signal<SyncStatus>('connecting');

  /** The board's name, or `null` while it loads and for a room without a stored board. */
  readonly boardName = toSignal(
    toObservable(this.boardId).pipe(
      switchMap((id) => this.#api.get(id)),
      map((board) => board?.name ?? null),
    ),
    { initialValue: null },
  );

  constructor() {
    this.#loader.load(this.#canvasElementSrc).catch(() => this.status.set('error'));
  }

  onCanvasReady(): void {
    this.status.set('ready');
  }

  onCanvasError(): void {
    this.status.set('error');
  }

  onSyncStatus(event: Event): void {
    this.syncStatus.set((event as CustomEvent<{ status: SyncStatus }>).detail.status);
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

  toggleTheme(): void {
    this.#themeService.toggle();
  }
}
