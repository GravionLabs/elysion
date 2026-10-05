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
