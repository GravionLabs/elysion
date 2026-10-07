import * as Y from 'yjs';
import { SESSION_MAP_KEY } from './timer';

/**
 * Dot voting (ADR 0020, option A): the sessions and the votes of a board live in its Yjs document, in the map
 * `session` under the key `voting`, next to the shared timer. Like the timer it is outside the Excalidraw binding:
 * Ctrl+Z does not touch it and no export contains it.
 *
 * The state is made of **nested Yjs types**, not of one plain object, on purpose: two people who vote at the same
 * moment each add to a list of their own (`votes[userId]`), so neither write replaces the other. With one plain object
 * under one key, the last writer would win and a vote would be lost.
 *
 * Anonymity: with option A every client receives the whole document, so the raw votes (who voted for what) are in it
 * and can be read by anybody who looks into it. The interface never shows them while a session is open (only a person's
 * own votes) and after it only counts, without names; that is a promise of the interface, not a property of the
 * system. Viewers cannot write to the document, so they cannot vote.
 */
export const VOTING_KEY = 'voting';

export const MAX_VOTES_PER_PERSON = 100;
export const MAX_SESSION_NAME_LENGTH = 80;
export const DEFAULT_SESSION_NAME = 'Voting';

export type VotingStatus = 'open' | 'closed';

export interface VotingStarter {
  id: string;
  name: string;
}

export interface VotingSession {
  id: string;
  name: string;
  votesPerPerson: number;
  status: VotingStatus;
  startedBy: VotingStarter;
  startedAt: number;
  closedAt: number | null;
  /** The elements each person voted for, by user id: one entry per vote (an element may appear several times). */
  votes: Readonly<Record<string, readonly string[]>>;
}

export interface VotingState {
  sessions: readonly VotingSession[];
  openSessionId: string | null;
}

/** What `castVote` did. Only `voted` changed the document. */
export type CastResult = 'voted' | 'no-votes-left' | 'closed' | 'unknown-session';

/** The part of an element that voting needs; Excalidraw's elements have all of it. */
export interface VotableElement {
  id: string;
  isDeleted?: boolean;
  type?: string;
  text?: string;
  boundElements?: readonly { id: string; type: string }[] | null;
}

export interface TallyEntry {
  elementId: string;
  count: number;
  /** What the element is called in the results: its text (a sticky note's bound text), else its type. */
  label: string;
}

/** What the canvas tells the shell about the voting (event `voting`): the caller's own state, never the others'. */
export interface VotingView {
  id: string;
  name: string;
  votesPerPerson: number;
  status: VotingStatus;
  startedBy: VotingStarter;
  /** How many votes the caller has placed. */
  myVotes: number;
  /** The ranked result: only once the session is closed. */
  tally?: TallyEntry[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseSession(id: string, raw: unknown): VotingSession | null {
  if (!isObject(raw)) return null;
  const by = raw['startedBy'];
  if (
    typeof raw['name'] !== 'string' ||
    typeof raw['votesPerPerson'] !== 'number' ||
    (raw['status'] !== 'open' && raw['status'] !== 'closed') ||
    typeof raw['startedAt'] !== 'number' ||
    !isObject(by) ||
    typeof by['id'] !== 'string' ||
    typeof by['name'] !== 'string'
  ) {
    return null;
  }
  const votes: Record<string, string[]> = {};
  const rawVotes = raw['votes'];
  if (isObject(rawVotes)) {
    for (const [userId, list] of Object.entries(rawVotes)) {
      if (Array.isArray(list))
        votes[userId] = list.filter((v): v is string => typeof v === 'string');
    }
  }
  return {
    id,
    name: raw['name'],
    votesPerPerson: raw['votesPerPerson'],
    status: raw['status'],
    startedBy: { id: by['id'], name: by['name'] },
    startedAt: raw['startedAt'],
    closedAt: typeof raw['closedAt'] === 'number' ? raw['closedAt'] : null,
    votes,
  };
}

function votingMap(doc: Y.Doc): Y.Map<unknown> | null {
  const voting = doc.getMap<unknown>(SESSION_MAP_KEY).get(VOTING_KEY);
  return voting instanceof Y.Map ? voting : null;
}

function sessionsMap(doc: Y.Doc): Y.Map<unknown> | null {
  const sessions = votingMap(doc)?.get('sessions');
  return sessions instanceof Y.Map ? sessions : null;
}

/** The sessions of the board, as plain data, oldest first; a value that is not a session is left out. */
export function readVoting(doc: Y.Doc): VotingState {
  const voting = votingMap(doc);
  const sessions = sessionsMap(doc);
  const list: VotingSession[] = [];
  sessions?.forEach((value, id) => {
    const parsed = value instanceof Y.Map ? parseSession(id, value.toJSON()) : null;
    if (parsed) list.push(parsed);
  });
  list.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  const open = voting?.get('openSessionId');
  return {
    sessions: list,
    openSessionId: typeof open === 'string' && list.some((s) => s.id === open) ? open : null,
  };
}

/** The session the interface shows: the open one, else the one that was closed last, else none. */
export function currentSession(state: VotingState): VotingSession | null {
  const open = state.sessions.find((s) => s.id === state.openSessionId);
  if (open) return open;
  const closed = state.sessions.filter((s) => s.status === 'closed');
  closed.sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
  return closed[0] ?? null;
}

/** How many votes a person has placed in a session. */
export function votesPlaced(session: VotingSession, userId: string): number {
  return session.votes[userId]?.length ?? 0;
}

/** How many votes a person has left in a session. */
export function votesLeft(session: VotingSession, userId: string): number {
  return Math.max(0, session.votesPerPerson - votesPlaced(session, userId));
}

/** A person's own votes by element: how many dots each element has from them. */
export function ownVotesByElement(session: VotingSession, userId: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const elementId of session.votes[userId] ?? [])
    counts[elementId] = (counts[elementId] ?? 0) + 1;
  return counts;
}

/** What an element is called in the results. */
export function elementLabel(element: VotableElement, all: readonly VotableElement[]): string {
  const clip = (text: string) => {
    const one = text.replace(/\s+/g, ' ').trim();
    return one.length > 60 ? `${one.slice(0, 57)}…` : one;
  };
  if (element.type === 'text' && element.text?.trim()) return clip(element.text);
  const bound = element.boundElements?.find((b) => b.type === 'text');
  const text = bound ? all.find((e) => e.id === bound.id)?.text : undefined;
  if (text?.trim()) return clip(text);
  return element.type ?? 'element';
}

/**
 * The result of a session: the votes per element, the most voted first (ties by label, then id, so the order is the
 * same on every client). Votes for an element that is deleted, or gone, are not counted: an undone delete brings them back.
 */
export function tally(session: VotingSession, elements: readonly VotableElement[]): TallyEntry[] {
  const alive = new Map(elements.filter((e) => !e.isDeleted).map((e) => [e.id, e]));
  const counts = new Map<string, number>();
  for (const list of Object.values(session.votes)) {
    for (const elementId of list) {
      if (alive.has(elementId)) counts.set(elementId, (counts.get(elementId) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([elementId, count]) => ({
      elementId,
      count,
      label: elementLabel(alive.get(elementId)!, elements),
    }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.label.localeCompare(b.label) ||
        a.elementId.localeCompare(b.elementId),
    );
}

/** What the shell is told for one person: their own state, and the tally once the session is closed. */
export function viewFor(
  session: VotingSession | null,
  userId: string,
  elements: readonly VotableElement[],
): VotingView | null {
  if (!session) return null;
  return {
    id: session.id,
    name: session.name,
    votesPerPerson: session.votesPerPerson,
    status: session.status,
    startedBy: session.startedBy,
    myVotes: votesPlaced(session, userId),
    ...(session.status === 'closed' ? { tally: tally(session, elements) } : {}),
  };
}

export interface StartOptions {
  name?: string;
  votesPerPerson: number;
}

/** Opens a session for everybody on the board. Refuses a second one (end the first) and a number of votes that makes no sense. */
export function startSession(
  doc: Y.Doc,
  options: StartOptions,
  startedBy: VotingStarter,
  now: number = Date.now(),
): VotingSession {
  const votes = options.votesPerPerson;
  if (!Number.isInteger(votes) || votes < 1 || votes > MAX_VOTES_PER_PERSON) {
    throw new RangeError(
      `The votes per person must be a whole number between 1 and ${MAX_VOTES_PER_PERSON}.`,
    );
  }
  const name =
    (options.name ?? '').trim().slice(0, MAX_SESSION_NAME_LENGTH) || DEFAULT_SESSION_NAME;
  const id = crypto.randomUUID();
  doc.transact(() => {
    if (readVoting(doc).openSessionId !== null) throw new Error('A voting is already open.');
    const root = doc.getMap<unknown>(SESSION_MAP_KEY);
    let voting = votingMap(doc);
    if (!voting) {
      voting = new Y.Map<unknown>();
      root.set(VOTING_KEY, voting);
      voting.set('sessions', new Y.Map<unknown>());
      voting.set('openSessionId', null);
    }
    const sessions = voting.get('sessions') as Y.Map<unknown>;
    const session = new Y.Map<unknown>();
    sessions.set(id, session);
    session.set('name', name);
    session.set('votesPerPerson', votes);
    session.set('status', 'open');
    session.set('startedBy', { id: startedBy.id, name: startedBy.name });
    session.set('startedAt', now);
    session.set('closedAt', null);
    session.set('votes', new Y.Map<unknown>());
    voting.set('openSessionId', id);
  });
  return readVoting(doc).sessions.find((s) => s.id === id)!;
}

function sessionOf(doc: Y.Doc, sessionId: string): Y.Map<unknown> | null {
  const session = sessionsMap(doc)?.get(sessionId);
  return session instanceof Y.Map ? session : null;
}

/** Puts one vote of a person on an element, unless the session is closed or the person has no vote left. */
export function castVote(
  doc: Y.Doc,
  sessionId: string,
  userId: string,
  elementId: string,
): CastResult {
  let result: CastResult = 'unknown-session';
  doc.transact(() => {
    const session = sessionOf(doc, sessionId);
    if (!session) return;
    if (session.get('status') !== 'open') {
      result = 'closed';
      return;
    }
    const votes = session.get('votes') as Y.Map<unknown>;
    let list = votes.get(userId);
    if (!(list instanceof Y.Array)) {
      list = new Y.Array<string>();
      votes.set(userId, list);
    }
    const mine = list as Y.Array<string>;
    if (mine.length >= (session.get('votesPerPerson') as number)) {
      result = 'no-votes-left';
      return;
    }
    mine.push([elementId]);
    result = 'voted';
  });
  return result;
}

/** Takes back one vote of a person from an element; `false` when they had none there or the session is closed. */
export function retractVote(
  doc: Y.Doc,
  sessionId: string,
  userId: string,
  elementId: string,
): boolean {
  let done = false;
  doc.transact(() => {
    const session = sessionOf(doc, sessionId);
    if (!session || session.get('status') !== 'open') return;
    const list = (session.get('votes') as Y.Map<unknown>).get(userId);
    if (!(list instanceof Y.Array)) return;
    const index = (list.toArray() as string[]).lastIndexOf(elementId);
    if (index < 0) return;
    list.delete(index, 1);
    done = true;
  });
  return done;
}

/** Closes the open session: nobody can vote any more, and the result can be shown. `false` when it was closed already. */
export function endSession(doc: Y.Doc, sessionId: string, now: number = Date.now()): boolean {
  let done = false;
  doc.transact(() => {
    const session = sessionOf(doc, sessionId);
    if (!session || session.get('status') !== 'open') return;
    session.set('status', 'closed');
    session.set('closedAt', now);
    const voting = votingMap(doc)!;
    if (voting.get('openSessionId') === sessionId) voting.set('openSessionId', null);
    done = true;
  });
  return done;
}

/** Removes a session with its votes (an open one too: that cancels it). `false` when there is no such session. */
export function clearResults(doc: Y.Doc, sessionId: string): boolean {
  let done = false;
  doc.transact(() => {
    const sessions = sessionsMap(doc);
    if (!sessions?.has(sessionId)) return;
    sessions.delete(sessionId);
    const voting = votingMap(doc)!;
    if (voting.get('openSessionId') === sessionId) voting.set('openSessionId', null);
    done = true;
  });
  return done;
}
