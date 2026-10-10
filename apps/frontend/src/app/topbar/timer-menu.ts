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
} from '@angular/core';
import type { TimerState } from '../board/canvas-element';
import { formatClock, timerEnded, timerRemaining } from '../board/timer';
import { TimerChime } from './timer-chime';

/** The lengths the menu offers, in minutes. */
export const TIMER_PRESETS: readonly number[] = [1, 2, 5, 10, 15];

/** How long the chip shows a red 00:00 before the timer is cleared. */
export const END_DISPLAY_MS = 5000;

/**
 * Another client waits this much longer before it clears an ended timer: the one that started it clears it, and the
 * others only step in when it is gone. Clearing is idempotent, so two clients doing it is harmless.
 */
export const TAKEOVER_GRACE_MS = 3000;

/** The chime is played for a timer that ended just now, not for one that ended before this client looked. */
const FRESH_END_MS = 3000;

export const MUTED_STORAGE_KEY = 'elysion.timer.muted';

const MAX_MINUTES = 24 * 60;

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTED_STORAGE_KEY, String(muted));
  } catch {
    // A private window or blocked storage: the choice only lasts for this page.
  }
}

/**
 * The Timer part of the top bar (ADR 0020): a menu to start a countdown for everybody on the board, and, while one
 * runs, the countdown chip. Everybody sees the chip; only those who may change the board (`canControl`) get the menu
 * and the pause, resume, +1 min and stop buttons. The state is the board's, shared through the canvas; this
 * component only shows it (second by second, from the local clock) and asks for changes. At zero the chip turns red for
 * five seconds, a chime plays once (unless muted, kept per browser) and the timer is cleared.
 */
@Component({
  selector: 'app-timer-menu',
  styleUrl: './timer-menu.scss',
  templateUrl: './timer-menu.html',
})
export class TimerMenu {
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly #chime = inject(TimerChime);

  /** The board's shared timer, or `null`. */
  readonly timer = input<TimerState | null>(null);
  /** Whether this user may start and change the timer: editors and owners. */
  readonly canControl = input(false);
  /** Who this user is, to know whether they started the timer (and so clear it when it has ended). */
  readonly userId = input<string | null>(null);

  readonly startRequested = output<number>();
  readonly pauseRequested = output<void>();
  readonly resumeRequested = output<void>();
  readonly extendRequested = output<number>();
  readonly stopRequested = output<void>();

  protected readonly presets = TIMER_PRESETS;
  protected readonly open = signal(false);
  protected readonly minutes = signal('5');
  protected readonly error = signal<string | null>(null);
  protected readonly muted = signal(readMuted());
  /** The local clock, moved on every second while a timer is shown. */
  protected readonly now = signal(Date.now());

  protected readonly remainingMs = computed(() => {
    const timer = this.timer();
    return timer ? timerRemaining(timer, this.now()) : 0;
  });
  protected readonly clock = computed(() => formatClock(this.remainingMs()));
  protected readonly paused = computed(() => this.timer()?.pausedAt != null);
  protected readonly ended = computed(() => {
    const timer = this.timer();
    return timer !== null && timerEnded(timer, this.now());
  });
  protected readonly muteLabel = computed(() =>
    this.muted()
      ? $localize`:@@topbar.timer.unmute-aria:Turn the end chime on`
      : $localize`:@@topbar.timer.mute-aria:Mute the end chime`,
  );
  protected readonly muteTitle = computed(() =>
    this.muted()
      ? $localize`:@@topbar.timer.muted-title:The end chime is muted`
      : $localize`:@@topbar.timer.mute-aria:Mute the end chime`,
  );
  protected readonly startedByLabel = computed(() => {
    const by = this.timer()?.startedBy.name;
    return by
      ? $localize`:@@topbar.timer.started-by:Started by ${by}:name:`
      : $localize`:@@topbar.timer.button:Timer`;
  });

  /** Identifies the timer that has ended, so the end is handled once however often the clock ticks. */
  readonly #endedKey = computed(() => {
    const timer = this.timer();
    return timer && this.ended()
      ? `${timer.startedAt}:${timer.durationMs}:${timer.startedBy.id}`
      : null;
  });

  constructor() {
    // While a timer is shown the clock ticks every second from the local time.
    effect((onCleanup) => {
      if (this.timer()) {
        this.now.set(Date.now());
        const id = setInterval(() => this.now.set(Date.now()), 1000);
        onCleanup(() => clearInterval(id));
      }
    });

    // The end: a chime once, and the shared state cleared after the red 00:00 (by the one who started it, or later by
    // any other client that may write, if that one is gone).
    effect((onCleanup) => {
      const key = this.#endedKey();
      if (key === null) return;
      untracked(() => {
        const timer = this.timer()!;
        const endedAt = timer.startedAt + timer.durationMs;
        if (!this.muted() && Date.now() - endedAt < FRESH_END_MS) {
          this.#chime.play();
        }
        if (this.canControl()) {
          const starter = this.userId() !== null && this.userId() === timer.startedBy.id;
          const id = setTimeout(
            () => this.stopRequested.emit(),
            END_DISPLAY_MS + (starter ? 0 : TAKEOVER_GRACE_MS),
          );
          onCleanup(() => clearTimeout(id));
        }
      });
    });
  }

  protected toggle(): void {
    this.open.update((open) => !open);
    this.error.set(null);
  }

  protected pick(minutes: number): void {
    this.minutes.set(String(minutes));
    this.error.set(null);
  }

  protected updateMinutes(event: Event): void {
    this.minutes.set((event.target as HTMLInputElement).value);
    this.error.set(null);
  }

  protected start(): void {
    const value = Number(this.minutes().trim().replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0 || value > MAX_MINUTES) {
      this.error.set(
        $localize`:@@topbar.timer.error:Enter a number of minutes between 1 and ${MAX_MINUTES}:max:.`,
      );
      return;
    }
    this.open.set(false);
    this.startRequested.emit(Math.round(value * 60_000));
  }

  protected toggleMute(): void {
    this.muted.update((muted) => !muted);
    writeMuted(this.muted());
  }

  @HostListener('document:click', ['$event'])
  protected closeOnOutsideClick(event: Event): void {
    if (this.open() && !this.#host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }

  @HostListener('keydown.escape')
  protected closeOnEscape(): void {
    this.open.set(false);
  }
}
