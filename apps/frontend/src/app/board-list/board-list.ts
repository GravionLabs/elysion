import { DatePipe } from '@angular/common';
import { Component, ElementRef, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ThemeService } from '../theme/theme.service';
import { BoardApi, BoardInfo, MAX_BOARD_NAME_LENGTH } from '../board/board-api';

export const DEFAULT_NEW_BOARD_NAME = 'Untitled board';

type ListState = 'loading' | 'ready' | 'error';
type CreateState = 'closed' | 'editing' | 'saving';

/** The home page: the boards, newest first, and a way to start a new one. */
@Component({
  imports: [DatePipe, RouterLink],
  selector: 'app-board-list',
  styleUrl: './board-list.scss',
  templateUrl: './board-list.html',
})
export class BoardList {
  readonly #api = inject(BoardApi);
  readonly #router = inject(Router);
  // Injected so the theme is applied to the page, which the board page does through its top bar.
  readonly #theme = inject(ThemeService);

  protected readonly maxNameLength = MAX_BOARD_NAME_LENGTH;
  protected readonly theme = this.#theme.theme;

  protected readonly state = signal<ListState>('loading');
  protected readonly boards = signal<BoardInfo[]>([]);

  protected readonly createState = signal<CreateState>('closed');
  protected readonly draftName = signal(DEFAULT_NEW_BOARD_NAME);
  protected readonly createError = signal<string | null>(null);

  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  constructor() {
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
    this.draftName.set(DEFAULT_NEW_BOARD_NAME);
    this.createError.set(null);
    this.createState.set('editing');
  }

  protected cancelCreate(): void {
    if (this.createState() !== 'saving') {
      this.createState.set('closed');
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
      next: (board) => void this.#router.navigateByUrl(board.path),
      error: () => {
        this.createState.set('editing');
        this.createError.set('The board could not be created. Try again.');
      },
    });
  }
}
