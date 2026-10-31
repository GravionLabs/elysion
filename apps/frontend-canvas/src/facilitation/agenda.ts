import type * as Y from 'yjs';
import { MAX_TIMER_MS, SESSION_MAP_KEY, type TimerStarter, startTimer, stopTimer } from './timer';

/**
 * The agenda of a workshop (#849), in the same place and for the same reasons as the timer (ADR 0020, option A): a plain
 * object `{ items }` under the key `agenda` of the document's map `session`, outside the Excalidraw binding (Ctrl+Z never
 * touches it and no picture export contains it). Everybody needs it at once, a reload and a late joiner get it with the
 * document. Only editors and owners write it: the realtime service refuses a viewer's write to `session` except under
 * `comments` (`viewerMayApply`).
 *
 * The list is written as a whole (last writer wins): two editors who change it in the same second may lose one change. That
 * is accepted for a list that one facilitator runs; a list of Yjs maps could be introduced later under another key.
 *
 * Time: like the timer, an item's time is measured with the clock of the client that started it (`startedAt`); the time
 * spent is the wall time an item was current, summed over every time it was (a paused timer does not stop it).
 */
export const AGENDA_KEY = 'agenda';

/** The longest title of an item. */
export const MAX_AGENDA_TITLE_LENGTH = 200;
/** The most items an agenda holds: a guard, not a product rule. */
export const MAX_AGENDA_ITEMS = 100;
/** The shortest and the longest planned duration of an item, in minutes (the timer's own limit is a day). */
export const MIN_AGENDA_MINUTES = 1;
export const MAX_AGENDA_MINUTES = MAX_TIMER_MS / 60_000;
/** The planned duration of a new item. */
export const DEFAULT_AGENDA_MINUTES = 10;

export type AgendaItemState = 'pending' | 'current' | 'done';

export interface AgendaItem {
  id: string;
  title: string;
  /** The planned duration, whole minutes. */
  durationMin: number;
  /** The frame the item is about (an element id), or `null`. */
  frameId: string | null;
  state: AgendaItemState;
  /** The time spent on the item before its current run (or in all, once it is not current), in milliseconds. */
  spentMs: number;
  /** When the item became current (epoch milliseconds), or `null` while it is not. */
  startedAt: number | null;
}

const STATES: readonly AgendaItemState[] = ['pending', 'current', 'done'];

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** A title as it is stored: trimmed, at most {@link MAX_AGENDA_TITLE_LENGTH} characters. */
export function cleanTitle(title: string): string {
  return title.trim().slice(0, MAX_AGENDA_TITLE_LENGTH);
}

/** A duration as it is stored: whole minutes within the limits. */
export function cleanMinutes(minutes: number): number {
  if (!isFiniteNumber(minutes)) return DEFAULT_AGENDA_MINUTES;
  return Math.min(MAX_AGENDA_MINUTES, Math.max(MIN_AGENDA_MINUTES, Math.round(minutes)));
}

/** One stored item, or `null` when it is not one. */
function parseItem(value: unknown): AgendaItem | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw['id'] !== 'string' || raw['id'] === '' || typeof raw['title'] !== 'string') {
    return null;
  }
  if (!isFiniteNumber(raw['durationMin'])) return null;
  const state = STATES.includes(raw['state'] as AgendaItemState)
    ? (raw['state'] as AgendaItemState)
    : 'pending';
  const startedAt = isFiniteNumber(raw['startedAt']) ? raw['startedAt'] : null;
  return {
    id: raw['id'],
    title: cleanTitle(raw['title']),
    durationMin: cleanMinutes(raw['durationMin']),
    frameId: typeof raw['frameId'] === 'string' && raw['frameId'] !== '' ? raw['frameId'] : null,
    // A current item without a start is not running: it is pending again.
    state: state === 'current' && startedAt === null ? 'pending' : state,
    spentMs: isFiniteNumber(raw['spentMs']) && raw['spentMs'] > 0 ? raw['spentMs'] : 0,
    startedAt: state === 'current' ? startedAt : null,
  };
}

/**
 * The stored value as the list of items: another client, or an older version, may have written anything. Items that are not
 * items are left out, an id that comes twice is kept once, and only the first current item stays current.
 */
export function parseAgenda(value: unknown): AgendaItem[] {
  const raw = (value as { items?: unknown } | null | undefined)?.items;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  let current = false;
  const items: AgendaItem[] = [];
  for (const entry of raw.slice(0, MAX_AGENDA_ITEMS)) {
    const item = parseItem(entry);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    if (item.state === 'current') {
      if (current) {
        items.push({ ...item, state: 'pending', startedAt: null });
        continue;
      }
      current = true;
    }
    items.push(item);
  }
  return items;
}

/** The time spent on an item at `now`: what it had, plus the running time while it is current. */
export function spentOn(item: AgendaItem, now: number): number {
  const running = item.state === 'current' && item.startedAt !== null ? now - item.startedAt : 0;
  return item.spentMs + Math.max(0, running);
}

/** The planned time of all items, in minutes. */
export function totalMinutes(items: readonly AgendaItem[]): number {
  return items.reduce((sum, item) => sum + item.durationMin, 0);
}

/**
 * When the agenda is planned to end: the current item's planned end (its start plus its duration, or `now` when it has run
 * over), plus the planned durations of the items still pending. With no current item it starts `now`. `null` when nothing is
 * left to do.
 */
export function plannedEnd(items: readonly AgendaItem[], now: number): number | null {
  const current = items.find((item) => item.state === 'current');
  const pending = items.filter((item) => item.state === 'pending');
  if (!current && pending.length === 0) return null;
  const from = current
    ? Math.max(now, (current.startedAt ?? now) + current.durationMin * 60_000)
    : now;
  return from + pending.reduce((sum, item) => sum + item.durationMin * 60_000, 0);
}

/** The current item, or `null`. */
export function currentItem(items: readonly AgendaItem[]): AgendaItem | null {
  return items.find((item) => item.state === 'current') ?? null;
}

/** A new pending item at the end. */
export function addItem(
  items: readonly AgendaItem[],
  id: string,
  title: string,
  durationMin: number = DEFAULT_AGENDA_MINUTES,
): AgendaItem[] {
  if (items.length >= MAX_AGENDA_ITEMS) {
    throw new RangeError(`An agenda holds at most ${MAX_AGENDA_ITEMS} items.`);
  }
  const clean = cleanTitle(title);
  if (clean === '') throw new RangeError('An agenda item needs a title.');
  return [
    ...items,
    {
      id,
      title: clean,
      durationMin: cleanMinutes(durationMin),
      frameId: null,
      state: 'pending',
      spentMs: 0,
      startedAt: null,
    },
  ];
}

const update = (
  items: readonly AgendaItem[],
  id: string,
  change: (item: AgendaItem) => AgendaItem,
): AgendaItem[] => items.map((item) => (item.id === id ? change(item) : item));

/** The item with another title; an empty title is refused. */
export function renameItem(items: readonly AgendaItem[], id: string, title: string): AgendaItem[] {
  const clean = cleanTitle(title);
  if (clean === '') throw new RangeError('An agenda item needs a title.');
  return update(items, id, (item) => ({ ...item, title: clean }));
}

/** The item with another planned duration. */
export function setDuration(
  items: readonly AgendaItem[],
  id: string,
  durationMin: number,
): AgendaItem[] {
  return update(items, id, (item) => ({ ...item, durationMin: cleanMinutes(durationMin) }));
}

/** The item linked to a frame, or to none (`null`). */
export function linkFrame(
  items: readonly AgendaItem[],
  id: string,
  frameId: string | null,
): AgendaItem[] {
  return update(items, id, (item) => ({ ...item, frameId }));
}

/** The list without the item. */
export function removeItem(items: readonly AgendaItem[], id: string): AgendaItem[] {
  return items.filter((item) => item.id !== id);
}

/** The list with the item moved to `index` (clamped to the list); an unknown id changes nothing. */
export function moveItem(items: readonly AgendaItem[], id: string, index: number): AgendaItem[] {
  const from = items.findIndex((item) => item.id === id);
  if (from < 0) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, index)), 0, moved);
  return next;
}

/** An item that stops being current: its running time is added to what it had, and it is done. */
const finished = (item: AgendaItem, now: number): AgendaItem => ({
  ...item,
  state: 'done',
  spentMs: spentOn(item, now),
  startedAt: null,
});

/**
 * The list with `id` current from `now`. The item that was current is done (its time is kept); an item that was done
 * already runs again and its time adds up. An unknown id changes nothing.
 */
export function startItem(items: readonly AgendaItem[], id: string, now: number): AgendaItem[] {
  if (!items.some((item) => item.id === id)) return [...items];
  return items.map((item) => {
    if (item.id === id) {
      return item.state === 'current' ? item : { ...item, state: 'current', startedAt: now };
    }
    return item.state === 'current' ? finished(item, now) : item;
  });
}

/**
 * "Next": the current item is done and the first pending item after it (or, with none current, the first pending one) is
 * current. `next` is that item, or `null` when the agenda is through.
 */
export function nextItem(
  items: readonly AgendaItem[],
  now: number,
): { items: AgendaItem[]; next: AgendaItem | null } {
  const at = items.findIndex((item) => item.state === 'current');
  const after = items.findIndex((item, index) => index > at && item.state === 'pending');
  const target = after >= 0 ? after : items.findIndex((item) => item.state === 'pending');
  const next = items.map((item, index) => {
    if (index === target) return { ...item, state: 'current' as const, startedAt: now };
    return item.state === 'current' ? finished(item, now) : item;
  });
  return { items: next, next: target >= 0 ? next[target] : null };
}

/** The plan without a run: every item pending and no time spent (a board made from a template, #849). */
export function resetRun(items: readonly AgendaItem[]): AgendaItem[] {
  return items.map((item) => ({ ...item, state: 'pending', spentMs: 0, startedAt: null }));
}

function sessionMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>(SESSION_MAP_KEY);
}

/** The board's agenda, an empty list when it has none. */
export function readAgenda(doc: Y.Doc): AgendaItem[] {
  return parseAgenda(sessionMap(doc).get(AGENDA_KEY));
}

/** Replaces the agenda with what `change` makes of it, in one transaction; an empty list removes the key. */
export function changeAgenda(
  doc: Y.Doc,
  change: (items: AgendaItem[]) => AgendaItem[],
): AgendaItem[] {
  let result: AgendaItem[] = [];
  doc.transact(() => {
    result = change(readAgenda(doc));
    const map = sessionMap(doc);
    if (result.length === 0) {
      if (map.has(AGENDA_KEY)) map.delete(AGENDA_KEY);
    } else map.set(AGENDA_KEY, { items: result });
  });
  return result;
}

/**
 * Starts an item for everybody: it is current, and the shared timer (#579) runs for its planned duration. Returns the item,
 * or `null` when it is not on the agenda. One transaction, so nobody sees the item without its timer.
 */
export function runItem(
  doc: Y.Doc,
  id: string,
  startedBy: TimerStarter,
  now: number = Date.now(),
): AgendaItem | null {
  let started: AgendaItem | null = null;
  doc.transact(() => {
    const items = changeAgenda(doc, (list) => startItem(list, id, now));
    started = items.find((item) => item.id === id) ?? null;
    if (started) startTimer(doc, started.durationMin * 60_000, startedBy, now);
  });
  return started;
}

/**
 * "Next" for everybody: the current item is done and the next one runs with the timer; once the agenda is through the timer
 * is stopped. Returns the item that runs now, or `null`.
 */
export function runNext(
  doc: Y.Doc,
  startedBy: TimerStarter,
  now: number = Date.now(),
): AgendaItem | null {
  let started: AgendaItem | null = null;
  doc.transact(() => {
    changeAgenda(doc, (list) => {
      const result = nextItem(list, now);
      started = result.next;
      return result.items;
    });
    const item = started as AgendaItem | null;
    if (item) startTimer(doc, item.durationMin * 60_000, startedBy, now);
    else stopTimer(doc);
  });
  return started;
}

/** The key under which an `.excalidraw` file (a template, #849) carries the agenda next to the scene. */
export const AGENDA_FILE_KEY = 'elysionAgenda';

/** The plan of an agenda as a file carries it: titles, durations and frames, no run. */
export function agendaForFile(
  items: readonly AgendaItem[],
): { id: string; title: string; durationMin: number; frameId: string | null }[] {
  return items.map(({ id, title, durationMin, frameId }) => ({ id, title, durationMin, frameId }));
}

/**
 * The agenda an `.excalidraw` file carries, as a plan to start from (every item pending, no time spent), or `null` when the
 * file has none (or is not JSON).
 */
export function agendaFromFile(text: string): AgendaItem[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const raw = (data as Record<string, unknown> | null)?.[AGENDA_FILE_KEY];
  if (!Array.isArray(raw)) return null;
  return resetRun(parseAgenda({ items: raw }));
}
