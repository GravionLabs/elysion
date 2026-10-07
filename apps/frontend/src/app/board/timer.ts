import type { TimerState } from './canvas-element';

/** What is left at `now` (epoch ms): the time at the pause for a paused timer, else the time until the end; never below zero. */
export function timerRemaining(timer: TimerState, now: number): number {
  if (timer.pausedAt !== null) {
    return Math.max(0, timer.remainingAtPauseMs ?? 0);
  }
  return Math.max(0, timer.startedAt + timer.durationMs - now);
}

/** A running timer that has reached zero. */
export function timerEnded(timer: TimerState, now: number): boolean {
  return timer.pausedAt === null && timerRemaining(timer, now) === 0;
}

/**
 * The time as a clock: `mm:ss`, `h:mm:ss` from an hour on. Rounded up to the second, so the clock shows 00:00 only
 * once the time is really over.
 */
export function formatClock(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${two(minutes)}:${two(seconds)}`;
}
