import type * as Y from 'yjs';

/**
 * The shared timer of a board (ADR 0020, option A): a plain object under the key `timer` of the document's map
 * `session`, next to the map `elements` that Excalidraw is bound to. It syncs, persists and survives a reload like the
 * scene does, but it is outside the Excalidraw binding, so Ctrl+Z never touches it and no export contains it.
 *
 * Time: the end of the timer is computed on every client from `startedAt` with its own clock (`Date.now()`); the
 * realtime service has no time API. A client whose clock is a few seconds off shows a few seconds too much or too
 * little. That is accepted for a workshop timer; a server-time offset could be added later without changing the
 * stored shape.
 */
export const SESSION_MAP_KEY = 'session';
export const TIMER_KEY = 'timer';

/** The longest a timer, or an extension of it, may be: a day. A guard against a typo, not a product rule. */
export const MAX_TIMER_MS = 24 * 60 * 60 * 1000;

/** Who started the timer, for the tooltip of the chip. */
export interface TimerStarter {
  id: string;
  name: string;
}

export interface TimerState {
  /** The length of the timer, including extensions. */
  durationMs: number;
  /** When it started, in epoch milliseconds of the client that started (or last resumed) it; moves on resume. */
  startedAt: number;
  /** When it was paused, or `null` while it runs. */
  pausedAt: number | null;
  /** What was left when it was paused, or `null` while it runs. */
  remainingAtPauseMs: number | null;
  startedBy: TimerStarter;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** What is read from the document before it is checked: anything another client wrote. */
interface RawTimer {
  durationMs?: unknown;
  startedAt?: unknown;
  pausedAt?: unknown;
  remainingAtPauseMs?: unknown;
  startedBy?: { id?: unknown; name?: unknown } | null;
}

/** A stored value as a timer, or `null` when it is not one: another client, or an older version, may have written anything. */
export function parseTimer(value: unknown): TimerState | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as RawTimer;
  const by = v.startedBy;
  if (
    !isFiniteNumber(v.durationMs) ||
    !isFiniteNumber(v.startedAt) ||
    typeof by !== 'object' ||
    by === null ||
    typeof by.id !== 'string' ||
    typeof by.name !== 'string'
  ) {
    return null;
  }
  const isPaused = v.pausedAt !== null && v.pausedAt !== undefined;
  if (isPaused && (!isFiniteNumber(v.pausedAt) || !isFiniteNumber(v.remainingAtPauseMs)))
    return null;
  return {
    durationMs: v.durationMs,
    startedAt: v.startedAt,
    pausedAt: isPaused ? (v.pausedAt as number) : null,
    remainingAtPauseMs: isPaused ? (v.remainingAtPauseMs as number) : null,
    startedBy: { id: by.id, name: by.name },
  };
}

/** What is left at `now`: the time at the pause for a paused timer, else the time until the end; never below zero. */
export function remaining(state: TimerState, now: number): number {
  if (state.pausedAt !== null) return Math.max(0, state.remainingAtPauseMs ?? 0);
  return Math.max(0, state.startedAt + state.durationMs - now);
}

/** A running timer that has reached zero. */
export function hasEnded(state: TimerState, now: number): boolean {
  return state.pausedAt === null && remaining(state, now) === 0;
}

function checkMs(ms: number, what: string): void {
  if (!isFiniteNumber(ms) || ms <= 0 || ms > MAX_TIMER_MS) {
    throw new RangeError(`${what} must be a number of milliseconds between 1 and ${MAX_TIMER_MS}.`);
  }
}

/** The state of a timer that starts at `now`. */
export function started(durationMs: number, startedBy: TimerStarter, now: number): TimerState {
  checkMs(durationMs, 'A timer');
  return { durationMs, startedAt: now, pausedAt: null, remainingAtPauseMs: null, startedBy };
}

/** The timer stopped where it is; a timer that is paused already stays as it is. */
export function paused(state: TimerState, now: number): TimerState {
  if (state.pausedAt !== null) return state;
  return { ...state, pausedAt: now, remainingAtPauseMs: remaining(state, now) };
}

/** A paused timer running again with what was left; the time spent paused does not count. */
export function resumed(state: TimerState, now: number): TimerState {
  if (state.pausedAt === null) return state;
  const left = state.remainingAtPauseMs ?? 0;
  return {
    ...state,
    startedAt: now - (state.durationMs - left),
    pausedAt: null,
    remainingAtPauseMs: null,
  };
}

/** `ms` more time than is left now (also for a timer that has just ended, which then runs `ms` more). */
export function extended(state: TimerState, ms: number, now: number): TimerState {
  checkMs(ms, 'An extension');
  if (state.pausedAt !== null) {
    return {
      ...state,
      durationMs: state.durationMs + ms,
      remainingAtPauseMs: (state.remainingAtPauseMs ?? 0) + ms,
    };
  }
  return { ...state, durationMs: now - state.startedAt + remaining(state, now) + ms };
}

function sessionMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>(SESSION_MAP_KEY);
}

/** The shared timer, or `null` when there is none. */
export function readTimer(doc: Y.Doc): TimerState | null {
  return parseTimer(sessionMap(doc).get(TIMER_KEY));
}

/** Replaces the timer with what `change` makes of the current one, in one transaction; `null` from it leaves it as it is. */
function write(
  doc: Y.Doc,
  change: (current: TimerState | null) => TimerState | null,
): TimerState | null {
  let result: TimerState | null = null;
  doc.transact(() => {
    result = change(readTimer(doc));
    if (result) sessionMap(doc).set(TIMER_KEY, result);
  });
  return result;
}

/** Starts a timer for everybody on the board, replacing one that is there. */
export function startTimer(
  doc: Y.Doc,
  durationMs: number,
  startedBy: TimerStarter,
  now: number = Date.now(),
): TimerState {
  return write(doc, () => started(durationMs, startedBy, now))!;
}

/** Pauses the timer; `null` when there is none. */
export function pauseTimer(doc: Y.Doc, now: number = Date.now()): TimerState | null {
  return write(doc, (current) => (current ? paused(current, now) : null));
}

/** Lets a paused timer run on; `null` when there is none. */
export function resumeTimer(doc: Y.Doc, now: number = Date.now()): TimerState | null {
  return write(doc, (current) => (current ? resumed(current, now) : null));
}

/** Adds time to the timer; `null` when there is none. */
export function extendTimer(doc: Y.Doc, ms: number, now: number = Date.now()): TimerState | null {
  checkMs(ms, 'An extension');
  return write(doc, (current) => (current ? extended(current, ms, now) : null));
}

/** Removes the timer for everybody. Idempotent: stopping a board without a timer changes nothing. */
export function stopTimer(doc: Y.Doc): void {
  doc.transact(() => {
    const map = sessionMap(doc);
    if (map.has(TIMER_KEY)) map.delete(TIMER_KEY);
  });
}
