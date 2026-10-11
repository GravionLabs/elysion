/**
 * Dot voting (ADR 0029): the sessions and the votes of a board live in the business backend, not in the Yjs document.
 * The server decides what each person may see: while a voting is open a person has their own votes only (and, in
 * `placed`, how many each person has placed, never on what); the closed result is counts per element, with names only
 * when the facilitator chose "named". The canvas talks to the server through the `VotingApi` its host gives it (the
 * element property `votingApi`, like `fileStore`), and hears of changes by others through the realtime message `voting`.
 * What an element is called in the result and whether it still exists is the canvas's business.
 */
export const MAX_VOTES_PER_PERSON = 100;
export const MAX_SESSION_NAME_LENGTH = 80;
export const DEFAULT_SESSION_NAME = 'Voting';

export type VotingStatus = 'open' | 'closed';

export interface VotingPerson {
  id: string;
  name: string;
}

/** One element of a closed voting: how many votes it got, and from whom when the voting was named. */
export interface ResultEntry {
  elementId: string;
  count: number;
  voters?: VotingPerson[];
}

/** The voting as the API returns it to the caller (ADR 0029, `VotingView`). */
export interface ApiVoting {
  id: string;
  name: string;
  votesPerPerson: number;
  status: VotingStatus;
  named: boolean;
  startedBy: VotingPerson;
  startedAt?: string | number | null;
  closedAt?: string | number | null;
  /** How many votes the caller has placed. */
  myVotes: number;
  /** The caller's votes by element. */
  myElementVotes: Readonly<Record<string, number>>;
  /** While open: how many votes each person has placed. */
  placed?: Readonly<Record<string, number>>;
  /** Once closed: the counts per element. */
  result?: readonly ResultEntry[];
}

export interface StartOptions {
  name?: string;
  votesPerPerson: number;
  /** Show who voted for what in the result. Anonymous by default. */
  named?: boolean;
}

/**
 * What the host gives the canvas to reach the voting on the server. A rejection is an error the person is told about
 * (start, close, clear); a failed vote is not worth an error, the canvas just asks again for the state.
 */
export interface VotingApi {
  /** The board's current voting (the open one, else the last closed one), or `null` when it has none. */
  get(): Promise<ApiVoting | null>;
  start(options: StartOptions): Promise<ApiVoting>;
  /** Puts a vote on an element; resolves with the voting after it. Rejects when the person has no vote left or it is closed. */
  vote(votingId: string, elementId: string): Promise<ApiVoting>;
  /** Takes one of the person's votes back from an element; `null` when they had none there. */
  retract(votingId: string, elementId: string): Promise<ApiVoting | null>;
  /** Closes a voting; closing a closed one is the same. */
  close(votingId: string): Promise<ApiVoting>;
  /** Removes every closed voting of the board with its votes. */
  clear(): Promise<void>;
}

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
  /** Who voted for it, only in a named voting. */
  voters?: VotingPerson[];
}

/** What the canvas tells the shell about the voting (event `voting`): the caller's own state and the result once closed. */
export interface VotingView {
  id: string;
  name: string;
  votesPerPerson: number;
  status: VotingStatus;
  named: boolean;
  startedBy: VotingPerson;
  /** How many votes the caller has placed. */
  myVotes: number;
  /** The ranked result: only once the voting is closed. */
  tally?: TallyEntry[];
}

/** What the canvas knows about the voting for one person: what the shell is told, and what the badges draw. */
export interface VotingSnapshot {
  /** The current voting as the shell sees it (event `voting`), or `null`. */
  view: VotingView | null;
  /** The person's own votes by element, while the voting is open: the dots on the elements. Nothing once it is closed. */
  own: Readonly<Record<string, number>>;
  /** The id of the open voting, or `null`: what a click on an element votes in. */
  openSessionId: string | null;
}

export const NO_VOTING: VotingSnapshot = { view: null, own: {}, openSessionId: null };

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
 * The result of a voting: the votes per element, the most voted first (ties by label, then id, so the order is the same
 * on every client). Votes for an element that is deleted, or gone, are not counted.
 */
export function tally(
  result: readonly ResultEntry[],
  elements: readonly VotableElement[],
): TallyEntry[] {
  const alive = new Map(elements.filter((e) => !e.isDeleted).map((e) => [e.id, e]));
  return result
    .filter((entry) => alive.has(entry.elementId) && entry.count > 0)
    .map((entry) => ({
      elementId: entry.elementId,
      count: entry.count,
      label: elementLabel(alive.get(entry.elementId)!, elements),
      ...(entry.voters ? { voters: entry.voters } : {}),
    }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.label.localeCompare(b.label) ||
        a.elementId.localeCompare(b.elementId),
    );
}

/** What the canvas and the shell see of a voting: the view, the person's own dots while it is open. */
export function snapshotOf(
  voting: ApiVoting | null,
  elements: readonly VotableElement[],
): VotingSnapshot {
  if (!voting) return NO_VOTING;
  const open = voting.status === 'open';
  return {
    view: {
      id: voting.id,
      name: voting.name,
      votesPerPerson: voting.votesPerPerson,
      status: voting.status,
      named: voting.named,
      startedBy: voting.startedBy,
      myVotes: voting.myVotes,
      ...(open ? {} : { tally: tally(voting.result ?? [], elements) }),
    },
    own: open ? { ...voting.myElementVotes } : {},
    openSessionId: open ? voting.id : null,
  };
}
