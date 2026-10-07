import { DatePipe } from '@angular/common';
import { Component, ElementRef, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { AppBrand } from '../shared/app-brand';
import { SessionService } from '../auth/session.service';
import { UserMenu } from '../topbar/user-menu';
import { ThemeService } from '../theme/theme.service';
import { BoardApi, BoardInfo, MAX_BOARD_NAME_LENGTH } from '../board/board-api';
import { TEMPLATE_STATE_KEY, TemplateApi, TemplateInfo } from '../board/template-api';

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

export const DEFAULT_NEW_BOARD_NAME = 'Untitled board';

type ListState = 'loading' | 'ready' | 'error';
type CreateState = 'closed' | 'editing' | 'saving';

/** The home page: the boards, newest first, and a way to start a new one. */
@Component({
  imports: [AppBrand, DatePipe, RouterLink, UserMenu],
  selector: 'app-board-list',
  styleUrl: './board-list.scss',
  templateUrl: './board-list.html',
})
export class BoardList {
  protected readonly session = inject(SessionService);
  readonly #api = inject(BoardApi);
  readonly #templateApi = inject(TemplateApi);
  readonly #router = inject(Router);
  readonly #pageTitle = inject(Title);
  // Injected so the theme is applied to the page, which the board page does through its top bar.
  readonly #theme = inject(ThemeService);

  protected readonly initials = boardInitials;
  protected readonly tint = boardTint;
  protected readonly maxNameLength = MAX_BOARD_NAME_LENGTH;
  protected readonly theme = this.#theme.theme;

  protected readonly state = signal<ListState>('loading');
  protected readonly boards = signal<BoardInfo[]>([]);

  protected readonly createState = signal<CreateState>('closed');
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

  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  constructor() {
    this.#pageTitle.setTitle('Boards · Elysion');
    this.load();
    // Put the cursor in the name field, with the default selected, when the form opens.
    effect(() => {
      const input = this.nameInput()?.nativeElement;
      if (input) {
        untracked(() => {
          input.focus();
          input.select();
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
  }

  protected openCreate(): void {
    if (this.createState() !== 'closed') {
      return;
    }
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
      this.createError.set('Give the board a name.');
      return;
    }
    if (name.length > MAX_BOARD_NAME_LENGTH) {
      this.createError.set(`The name can have up to ${MAX_BOARD_NAME_LENGTH} characters.`);
      return;
    }

    this.createState.set('saving');
    this.#api.create(name).subscribe({
      next: (board) => {
        // The board page applies the template once it is connected (see Board); the choice travels in the history state.
        const templateId = this.selectedTemplateId();
        void (templateId
          ? this.#router.navigateByUrl(board.path, { state: { [TEMPLATE_STATE_KEY]: templateId } })
          : this.#router.navigateByUrl(board.path));
      },
      error: () => {
        this.createState.set('editing');
        this.createError.set('The board could not be created. Try again.');
      },
    });
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
        this.duplicateError.set(`The board “${board.name}” could not be duplicated. Try again.`);
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
        this.deleteError.set('The board could not be deleted. Try again.');
      },
    });
  }
}
