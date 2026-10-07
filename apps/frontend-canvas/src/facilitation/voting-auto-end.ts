import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { SESSION_MAP_KEY } from './timer';
import { allVoted, endSession, readVoting } from './voting';

/** What a client tells the others through the awareness about its part in a voting. */
export interface Voter {
  /** The id the votes of this person are kept under: the host's user id, else the tab's own id. */
  id: string;
  /** Whether this client may vote: a viewer is present but cannot, so a voting does not wait for them. */
  canVote: boolean;
}

const VOTER_FIELD = 'voter';

/** Tells the other clients who this one is for a voting, and whether it may vote. */
export function publishVoter(awareness: Awareness, voter: Voter): void {
  awareness.setLocalStateField(VOTER_FIELD, voter);
}

/** The people present on the board who may vote (this client included), once each: two tabs of one person are one. */
export function presentVoterIds(awareness: Awareness): string[] {
  const ids = new Set<string>();
  for (const state of awareness.getStates().values()) {
    const voter = (state as { voter?: Partial<Voter> } | undefined)?.voter;
    if (voter && voter.canVote === true && typeof voter.id === 'string') ids.add(voter.id);
  }
  return [...ids].sort();
}

export interface AllVotedWatch {
  /** Looks again now. */
  check(): void;
  destroy(): void;
}

/**
 * Ends the open voting by itself once everybody present who may vote has used all their votes. Every client that may
 * write watches (the votes change, people come and go) and ends it; ending is idempotent, so two clients doing it in the
 * same moment do no harm. A viewer never ends it (it cannot write) and is not waited for. Nobody present who may vote,
 * or somebody who has not yet spent their votes, leaves the voting open: the facilitator ends it then.
 */
export function watchAllVoted(
  doc: Y.Doc,
  awareness: Awareness,
  canWrite: () => boolean,
  now: () => number = Date.now,
): AllVotedWatch {
  const root = doc.getMap<unknown>(SESSION_MAP_KEY);
  const check = () => {
    if (!canWrite()) return;
    const state = readVoting(doc);
    const open = state.sessions.find((session) => session.id === state.openSessionId);
    if (open && allVoted(open, presentVoterIds(awareness))) endSession(doc, open.id, now());
  };
  root.observeDeep(check);
  awareness.on('change', check);
  return {
    check,
    destroy: () => {
      root.unobserveDeep(check);
      awareness.off('change', check);
    },
  };
}
