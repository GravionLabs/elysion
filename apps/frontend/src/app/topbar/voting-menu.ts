import {
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { VotingSession } from '../board/canvas-element';

/** What the Start form asks for. */
export interface VotingRequest {
  name: string;
  votesPerPerson: number;
}

/** The numbers of votes the form offers. */
export const VOTE_PRESETS: readonly number[] = [3, 5, 10];

const MAX_VOTES = 100;
const DEFAULT_NAME = $localize`:@@topbar.voting.button:Voting`;

/**
 * The Voting part of the top bar (ADR 0020): editors and owners start a dot voting (a name and the votes each person
 * has), see how many votes they have left and end it; once it is closed, by them or because everybody present has used
 * all their votes, the **results** open by themselves for everybody in a dialog
 * of their own, the ranked list of what got votes (a click scrolls the canvas to the element). The dialog sits on the
 * right of the window at first, can be moved (by its title, or with the arrow keys) and does not block the board;
 * editors and owners can clear the results or start another voting from it. A viewer sees the state and the results and has nothing to click while a voting is open.
 *
 * Anonymity: while a voting is open the interface knows only the caller's own number of votes, and the results are
 * counts without names. That is what the canvas tells the shell; the board's document holds more (the ADR says so).
 */
@Component({
  selector: 'app-voting-menu',
  styleUrl: './voting-menu.scss',
  templateUrl: './voting-menu.html',
})
export class VotingMenu {
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The board's current voting from the canvas's `voting` event, or `null`. */
  readonly session = input<VotingSession | null>(null);
  /** Whether this user may start, end and clear a voting: editors and owners. */
  readonly canControl = input(false);

  readonly startRequested = output<VotingRequest>();
  readonly endRequested = output<void>();
  readonly clearRequested = output<void>();
  /** The user clicked a result: scroll the canvas to that element. */
  readonly elementRequested = output<string>();

  protected readonly presets = VOTE_PRESETS;
  protected readonly open = signal(false);
  protected readonly name = signal(DEFAULT_NAME);
  protected readonly votes = signal('5');
  protected readonly error = signal<string | null>(null);
  protected readonly confirmingClear = signal(false);
  /** Whether the results dialog is open (only a closed voting has results). */
  protected readonly resultsOpen = signal(false);
  /** Where the results dialog was moved to, in pixels from the window's top left; `null` until it is: then it sits on the right. */
  protected readonly position = signal<{ x: number; y: number } | null>(null);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  #drag: { dx: number; dy: number } | null = null;
  #previousStatus: 'open' | 'closed' | null = null;

  protected readonly isOpen = computed(() => this.session()?.status === 'open');
  protected readonly isClosed = computed(() => this.session()?.status === 'closed');
  protected readonly left = computed(() => {
    const session = this.session();
    return session ? Math.max(0, session.votesPerPerson - session.myVotes) : 0;
  });
  protected readonly total = computed(() =>
    (this.session()?.tally ?? []).reduce((sum, entry) => sum + entry.count, 0),
  );
  /** The button: whether there is anything to open for this user. */
  protected readonly showButton = computed(() => this.session() !== null || this.canControl());

  constructor() {
    // The results belong to the voting that was closed: a new voting, or a clear, takes the dialog away.
    effect(() => {
      if (!this.isClosed()) {
        this.resultsOpen.set(false);
        this.confirmingClear.set(false);
      }
    });

    // The results open by themselves when a voting that was open is closed (the facilitator ended it, or everybody
    // present had used all their votes), for everybody. Somebody who joins later, or reloads, finds them closed.
    effect(() => {
      const status = this.session()?.status ?? null;
      untracked(() => {
        if (this.#previousStatus === 'open' && status === 'closed') {
          this.open.set(false);
          this.resultsOpen.set(true);
        }
        this.#previousStatus = status;
      });
    });
  }

  /** The button: the results of a closed voting open as a dialog, everything else as the menu under the button. */
  protected toggle(): void {
    this.error.set(null);
    this.confirmingClear.set(false);
    if (this.isClosed()) {
      this.open.set(false);
      this.resultsOpen.update((open) => !open);
      return;
    }
    this.open.update((open) => !open);
  }

  protected closeResults(): void {
    this.resultsOpen.set(false);
    this.confirmingClear.set(false);
  }

  /** From the results to the form for another voting. */
  protected newVoting(): void {
    this.closeResults();
    this.open.set(true);
  }

  protected dragStart(event: PointerEvent): void {
    const dialog = this.dialog()?.nativeElement;
    // A press on a button of the header (close, move) is not a drag.
    if (!dialog || event.button !== 0 || (event.target as Element).closest('button')) return;
    const box = dialog.getBoundingClientRect();
    this.#drag = { dx: event.clientX - box.left, dy: event.clientY - box.top };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  protected dragMove(event: PointerEvent): void {
    if (!this.#drag) return;
    this.#place(event.clientX - this.#drag.dx, event.clientY - this.#drag.dy);
  }

  protected dragEnd(event: PointerEvent): void {
    this.#drag = null;
    (event.currentTarget as Element).releasePointerCapture?.(event.pointerId);
  }

  /** The keyboard's way to move the dialog: the arrow keys on the move button, 16 pixels at a time. */
  protected moveByKey(event: KeyboardEvent): void {
    const step = 16;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = delta[event.key];
    const dialog = this.dialog()?.nativeElement;
    if (!move || !dialog) return;
    event.preventDefault();
    const box = dialog.getBoundingClientRect();
    this.#place(box.left + move[0], box.top + move[1]);
  }

  /** Puts the dialog's top left corner at a place, kept inside the window so its title stays reachable. */
  #place(x: number, y: number): void {
    const dialog = this.dialog()?.nativeElement;
    const width = dialog?.offsetWidth ?? 0;
    const maxX = Math.max(0, window.innerWidth - width);
    const maxY = Math.max(0, window.innerHeight - 48);
    this.position.set({
      x: Math.min(Math.max(0, x), maxX),
      y: Math.min(Math.max(0, y), maxY),
    });
  }

  protected pick(votes: number): void {
    this.votes.set(String(votes));
    this.error.set(null);
  }

  protected updateName(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
  }

  protected updateVotes(event: Event): void {
    this.votes.set((event.target as HTMLInputElement).value);
    this.error.set(null);
  }

  protected start(): void {
    const value = Number(this.votes().trim());
    if (!Number.isInteger(value) || value < 1 || value > MAX_VOTES) {
      this.error.set(
        $localize`:@@topbar.voting.error:Enter a whole number of votes between 1 and ${MAX_VOTES}:max:.`,
      );
      return;
    }
    this.open.set(false);
    this.startRequested.emit({ name: this.name().trim() || DEFAULT_NAME, votesPerPerson: value });
  }

  protected end(): void {
    this.open.set(false);
    this.endRequested.emit();
  }

  /** The first press asks, the second one clears. */
  protected clear(): void {
    if (!this.confirmingClear()) {
      this.confirmingClear.set(true);
      return;
    }
    this.confirmingClear.set(false);
    this.resultsOpen.set(false);
    this.clearRequested.emit();
  }

  protected show(elementId: string): void {
    this.elementRequested.emit(elementId);
  }

  @HostListener('document:click', ['$event'])
  protected closeOnOutsideClick(event: Event): void {
    if (this.open() && !this.#host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
      this.confirmingClear.set(false);
    }
  }

  @HostListener('keydown.escape')
  protected closeOnEscape(): void {
    this.open.set(false);
    this.closeResults();
  }
}
