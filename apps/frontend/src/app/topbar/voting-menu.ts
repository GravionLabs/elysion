import {
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
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
const DEFAULT_NAME = 'Voting';

/**
 * The Voting part of the top bar (ADR 0020): editors and owners start a dot voting (a name and the votes each person
 * has), see how many votes they have left and end it; once it is closed everybody opens the **results**, the ranked
 * list of what got votes (a click scrolls the canvas to the element), and editors and owners can clear them or start
 * another voting. A viewer sees the state and the results and has nothing to click while a voting is open.
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

  protected toggle(): void {
    this.open.update((open) => !open);
    this.error.set(null);
    this.confirmingClear.set(false);
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
      this.error.set(`Enter a whole number of votes between 1 and ${MAX_VOTES}.`);
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
    this.open.set(false);
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
    this.confirmingClear.set(false);
  }
}
