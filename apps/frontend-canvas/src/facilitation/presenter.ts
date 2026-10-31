import type * as Y from 'yjs';
import { SESSION_MAP_KEY } from './timer';
import { parseViewport, type Viewport } from '../presence/viewport';

/**
 * The presentation of a board, in the same place and for the same reasons as the timer (ADR 0020, option A): plain
 * objects under keys of the document's map `session`, outside the Excalidraw binding (so Ctrl+Z never touches them and
 * no export contains them). Only editors and owners may write them: the realtime service refuses a viewer's write to
 * `session` except under `comments` (`viewerMayApply`).
 *
 * - `presenter` (`{ userId, startedAt }`): everybody follows this person's viewport while they are in the awareness. The
 *   entry alone proves nothing (the person may have closed the tab hours ago), so a client ignores one whose person is not
 *   in the awareness and the presenter's own tab deletes a stale one when it loads (see `FollowController`).
 * - `summon` (`{ id, userId, viewport, at }`): "bring everyone to me", a one-off jump. A client remembers the `id` it found
 *   when it loaded and acts only on a different one later, so no clock is compared and a late joiner never jumps.
 */
export const PRESENTER_KEY = 'presenter';
export const SUMMON_KEY = 'summon';

export interface PresenterState {
  userId: string;
  /** Epoch milliseconds of the client that started; it only tells one presentation from another. */
  startedAt: number;
}

export interface SummonState {
  id: string;
  userId: string;
  viewport: Viewport;
  at: number;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** A stored value as a presenter, or `null`: another client, or an older version, may have written anything. */
export function parsePresenter(value: unknown): PresenterState | null {
  const raw = value as { userId?: unknown; startedAt?: unknown } | null | undefined;
  if (typeof raw !== 'object' || raw === null) return null;
  if (typeof raw.userId !== 'string' || raw.userId === '' || !isFiniteNumber(raw.startedAt)) {
    return null;
  }
  return { userId: raw.userId, startedAt: raw.startedAt };
}

/** A stored value as a summon, or `null`. */
export function parseSummon(value: unknown): SummonState | null {
  const raw = value as
    { id?: unknown; userId?: unknown; viewport?: unknown; at?: unknown } | null | undefined;
  if (typeof raw !== 'object' || raw === null) return null;
  const viewport = parseViewport(raw.viewport);
  if (
    typeof raw.id !== 'string' ||
    raw.id === '' ||
    typeof raw.userId !== 'string' ||
    !viewport ||
    !isFiniteNumber(raw.at)
  ) {
    return null;
  }
  return { id: raw.id, userId: raw.userId, viewport, at: raw.at };
}

function sessionMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>(SESSION_MAP_KEY);
}

/** The board's presenter, or `null` when nobody presents. */
export function readPresenter(doc: Y.Doc): PresenterState | null {
  return parsePresenter(sessionMap(doc).get(PRESENTER_KEY));
}

/** The last "bring everyone to me", or `null`. */
export function readSummon(doc: Y.Doc): SummonState | null {
  return parseSummon(sessionMap(doc).get(SUMMON_KEY));
}

/** Makes `userId` the presenter, replacing one that is there. */
export function startPresenting(
  doc: Y.Doc,
  userId: string,
  now: number = Date.now(),
): PresenterState {
  const state: PresenterState = { userId, startedAt: now };
  doc.transact(() => sessionMap(doc).set(PRESENTER_KEY, state));
  return state;
}

/** Ends the presentation for everybody. Idempotent. */
export function stopPresenting(doc: Y.Doc): void {
  doc.transact(() => {
    const map = sessionMap(doc);
    if (map.has(PRESENTER_KEY)) map.delete(PRESENTER_KEY);
  });
}

/** Brings everybody to `viewport`: a new summon with a new id. */
export function summonEveryone(
  doc: Y.Doc,
  userId: string,
  viewport: Viewport,
  now: number = Date.now(),
  id: string = crypto.randomUUID(),
): SummonState {
  const state: SummonState = { id, userId, viewport, at: now };
  doc.transact(() => sessionMap(doc).set(SUMMON_KEY, state));
  return state;
}

/**
 * Calls `onChange` when the stored value under `key` changes, on this client or another, with what `read` makes of the
 * session map (a change of another key or a rewrite with the same value is not announced).
 */
export function observeKey<T>(
  doc: Y.Doc,
  read: () => T,
  onChange: (value: T) => void,
): { destroy(): void } {
  const map = sessionMap(doc);
  let last = JSON.stringify(read());
  const observer = () => {
    const value = read();
    const json = JSON.stringify(value);
    if (json === last) return;
    last = json;
    onChange(value);
  };
  map.observe(observer);
  return { destroy: () => map.unobserve(observer) };
}
