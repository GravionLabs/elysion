import * as Y from 'yjs';
import { SESSION_MAP_KEY } from './timer';
import {
  type VotableElement,
  type VotingView,
  currentSession,
  ownVotesByElement,
  readVoting,
  viewFor,
} from './voting';

/** What the canvas knows about the voting for one person: what the shell is told, and what the badges draw. */
export interface VotingSnapshot {
  /** The current session as the shell sees it (event `voting`), or `null`. */
  view: VotingView | null;
  /** The person's own votes by element, while the session is open: the dots on the elements. Nothing once it is closed. */
  own: Readonly<Record<string, number>>;
  /** The id of the open session, or `null`: what a click on an element votes in. */
  openSessionId: string | null;
}

export interface VotingSync {
  /** The current snapshot. */
  read(): VotingSnapshot;
  /** Tells the callback the current snapshot again, also when it did not change. */
  emit(): void;
  destroy(): void;
}

/** The elements of the board as the document has them, deleted ones included (they are flagged, never removed). */
function elementsOf(doc: Y.Doc): VotableElement[] {
  return [...doc.getMap<unknown>('elements').values()] as VotableElement[];
}

/**
 * Watches the voting of a document for one person and calls `onChange` with a snapshot when it changed: a vote, a start,
 * the end, a clear, here or on another client, and, once a session is closed, a change of the elements (a deleted
 * element drops out of the result). A change that leaves the snapshot as it was is not announced.
 */
export function observeVoting(
  doc: Y.Doc,
  getUserId: () => string,
  onChange: (snapshot: VotingSnapshot) => void,
): VotingSync {
  const root = doc.getMap<unknown>(SESSION_MAP_KEY);
  const elements = doc.getMap<unknown>('elements');

  const read = (): VotingSnapshot => {
    const state = readVoting(doc);
    const session = currentSession(state);
    const userId = getUserId();
    return {
      view: viewFor(session, userId, session?.status === 'closed' ? elementsOf(doc) : []),
      own: session?.status === 'open' ? ownVotesByElement(session, userId) : {},
      openSessionId: state.openSessionId,
    };
  };

  let last = JSON.stringify(read());
  const check = () => {
    const snapshot = read();
    const json = JSON.stringify(snapshot);
    if (json === last) return;
    last = json;
    onChange(snapshot);
  };
  const onElements = () => {
    // Only a closed session shows a result that depends on the elements; while one is open nothing here matters.
    if (readVoting(doc).openSessionId === null) check();
  };

  root.observeDeep(check);
  elements.observe(onElements);
  return {
    read,
    emit: () => onChange(read()),
    destroy: () => {
      root.unobserveDeep(check);
      elements.unobserve(onElements);
    },
  };
}
