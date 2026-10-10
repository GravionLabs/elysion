import {
  Component,
  ElementRef,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { MAX_BOARD_NAME_LENGTH } from '../board/board-api';
import { AppBrand } from '../shared/app-brand';
import { Theme } from '../theme/theme.service';
import { ExportFormat } from '../board/download';
import type { PresentUser } from '../board/presence-store';
import { ExportMenu, ExportRequest } from './export-menu';
import { TemplateMenu } from './template-menu';
import { TimerMenu } from './timer-menu';
import { VotingMenu, type VotingRequest } from './voting-menu';
import type { TimerState, VotingSession } from '../board/canvas-element';
import { UserMenu } from './user-menu';
import type { TemplateInfo } from '../board/template-api';
import type { SessionUser } from '../auth/session.service';

/** The Yjs connection of the canvas, as its `status` event reports it. */
export type SyncStatus = 'connecting' | 'connected' | 'disconnected';

const MAX_AVATARS = 3;

const STATUS_LABEL: Record<SyncStatus, string> = {
  connecting: $localize`:@@topbar.status.connecting:Connecting…`,
  connected: $localize`:@@topbar.status.connected:Connected`,
  disconnected: $localize`:@@topbar.status.offline:Offline`,
};

/** The bar at the top of the board page, modeled on ariadne's: identity left, actions right. */
@Component({
  imports: [AppBrand, ExportMenu, RouterLink, TemplateMenu, TimerMenu, UserMenu, VotingMenu],
  selector: 'app-top-bar',
  styleUrl: './top-bar.scss',
  templateUrl: './top-bar.html',
})
export class TopBar {
  readonly boardId = input.required<string>();
  /** The board's name when it has one; a room without a record shows its id. */
  readonly boardName = input<string | null>(null);
  /** Whether the title can be edited: only a stored board has a name to change. */
  readonly canRename = input(false);
  readonly status = input<SyncStatus>('connecting');
  readonly theme = input.required<Theme>();
  /** Whether anything is selected on the canvas (enables 'selection only' in the Export menu). */
  readonly hasSelection = input(false);
  /** The format of the export being prepared; the Export menu waits for it. */
  readonly exporting = input<ExportFormat | null>(null);
  /** The board's shared timer, or `null` (ADR 0020); everybody sees it, only those who may write control it. */
  readonly timer = input<TimerState | null>(null);
  /** The board's current dot voting, or `null` (ADR 0020): everybody sees it, only those who may write control it. */
  readonly voting = input<VotingSession | null>(null);
  /** Whether the library sidebar is open. */
  readonly libraryOpen = input(false);
  /** Whether the user may share the board (an owner): the Share button is shown. */
  readonly canShare = input(false);
  /** A viewer: Import and Library, which only change the board, are hidden. */
  readonly readOnly = input(false);
  /** Who is signed in; the menu with the log-out action is shown for them. */
  readonly user = input<SessionUser | null>(null);
  /** The other people on the board. */
  readonly users = input<readonly PresentUser[]>([]);

  /** The user confirmed a new name (trimmed, different from the current one). */
  readonly renameRequested = output<string>();
  readonly themeToggle = output<void>();
  readonly libraryToggle = output<void>();
  readonly exportRequested = output<ExportRequest>();
  /** The user chose a template to add to the board. */
  readonly templateChosen = output<TemplateInfo>();
  /** The user wants to save the board, or the selection, as a template. */
  readonly saveTemplateRequested = output<{ selectionOnly: boolean }>();
  /** The user pressed Share. */
  readonly shareRequested = output<void>();
  /** The user chose Log out in the user menu. */
  readonly logoutRequested = output<void>();
  /** A file was picked for import; the page confirms before anything is replaced. */
  readonly importChosen = output<File>();
  /** The shared timer, asked for by those who may write: the board page calls the canvas. */
  readonly timerStart = output<number>();
  readonly timerPause = output<void>();
  readonly timerResume = output<void>();
  readonly timerExtend = output<number>();
  readonly timerStop = output<void>();
  /** The dot voting, asked for by those who may write; the board page calls the canvas. */
  readonly votingStart = output<VotingRequest>();
  readonly votingEnd = output<void>();
  readonly votingClear = output<void>();
  /** A result was clicked: scroll the canvas to the element. */
  readonly votingFocus = output<string>();

  protected readonly maxNameLength = MAX_BOARD_NAME_LENGTH;
  protected readonly editing = signal(false);
  protected readonly draft = signal('');
  protected readonly nameError = signal<string | null>(null);
  private readonly titleInput = viewChild<ElementRef<HTMLInputElement>>('titleInput');

  constructor() {
    // Put the cursor in the field, with the name selected, when editing starts.
    effect(() => {
      const field = this.titleInput()?.nativeElement;
      if (field) {
        untracked(() => {
          field.focus();
          field.select();
        });
      }
    });
  }

  protected startRename(): void {
    this.draft.set(this.title());
    this.nameError.set(null);
    this.editing.set(true);
  }

  protected updateDraft(event: Event): void {
    this.draft.set((event.target as HTMLInputElement).value);
    this.nameError.set(null);
  }

  /** Enter: saves a valid name; a blank one is refused and the field stays open. */
  protected submitRename(): void {
    this.finishRename(true);
  }

  /** Leaving the field saves a valid name and quietly drops a blank one. */
  protected blurRename(): void {
    this.finishRename(false);
  }

  protected cancelRename(): void {
    this.editing.set(false);
    this.nameError.set(null);
  }

  private finishRename(refuseBlank: boolean): void {
    if (!this.editing()) {
      return; // Escape already closed it; removing the field can still fire a blur
    }
    const name = this.draft().trim();
    if (!name) {
      if (refuseBlank) {
        this.nameError.set($localize`:@@topbar.rename.blank:A board needs a name.`);
      } else {
        this.cancelRename();
      }
      return;
    }
    this.cancelRename();
    if (name !== this.boardName()) {
      this.renameRequested.emit(name);
    }
  }

  protected chooseImport(event: Event): void {
    const fileInput = event.target as HTMLInputElement;
    const file = fileInput.files?.[0];
    fileInput.value = ''; // the same file can be chosen again
    if (file) {
      this.importChosen.emit(file);
    }
  }

  /** At most this many avatars are shown; the rest are a count. */
  protected readonly visibleUsers = computed(() => this.users().slice(0, MAX_AVATARS));
  protected readonly hiddenUsers = computed(() => Math.max(0, this.users().length - MAX_AVATARS));
  protected readonly presenceLabel = computed(() => {
    const names = this.users().map((user) => user.name);
    return names.length === 1
      ? $localize`:@@topbar.presence.one:${names[0]}:name: is on this board`
      : $localize`:@@topbar.presence.many:On this board: ${names.join(', ')}:names:`;
  });

  protected initialsOf(name: string): string {
    return (
      name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((word) => [...word][0].toUpperCase())
        .join('') || '?'
    );
  }

  protected readonly title = computed(() => this.boardName() ?? this.boardId());
  protected readonly renameLabel = computed(
    () => $localize`:@@topbar.rename-aria:Rename the board ${this.title()}:title:`,
  );
  protected readonly statusLabel = computed(() => STATUS_LABEL[this.status()]);
  protected readonly themeTitle = computed(() =>
    this.theme() === 'dark'
      ? $localize`:@@topbar.theme.to-light:Switch to the light theme`
      : $localize`:@@topbar.theme.to-dark:Switch to the dark theme`,
  );
}
