import type { Awareness } from 'y-protocols/awareness';

/** What a client tells the others through the awareness about its part in a voting. */
export interface Voter {
  /** The id of the person: the host's user id, else the tab's own id. */
  id: string;
  /** The voting the count below is about, if one is open. */
  votingId?: string | null;
  /** How many votes this person has placed in that voting (not on what). */
  votes?: number;
}

const VOTER_FIELD = 'voter';

/** Tells the other clients who this one is for a voting, and how many votes it has placed. */
export function publishVoter(awareness: Awareness, voter: Voter): void {
  awareness.setLocalStateField(VOTER_FIELD, voter);
}

function votersOf(awareness: Awareness): Voter[] {
  const voters = new Map<string, Voter>();
  for (const state of awareness.getStates().values()) {
    const voter = (state as { voter?: Partial<Voter> } | undefined)?.voter;
    if (voter && typeof voter.id === 'string') {
      // Two tabs of one person are one voter; the tab that has placed more counts.
      const known = voters.get(voter.id);
      if (!known || (voter.votes ?? 0) > (known.votes ?? 0)) {
        voters.set(voter.id, voter as Voter);
      }
    }
  }
  return [...voters.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** The people present on the board (this client included), once each. */
export function presentVoterIds(awareness: Awareness): string[] {
  return votersOf(awareness).map((voter) => voter.id);
}

export interface AllVotedWatch {
  /** Looks again now. */
  check(): void;
  destroy(): void;
}

/**
 * Closes the open voting by itself once everybody present (a viewer too: viewers vote) has used all their votes. Every client watches (the votes
 * change, people come and go) and one that may close it does; closing is idempotent on the server, so two clients doing
 * it in the same moment do no harm. Who has placed how many votes comes from the awareness (each client says it for
 * itself, the server's ids are not the host's), never on what. Nobody present, or somebody who has not yet spent their
 * votes, leaves the voting open: the facilitator closes it then.
 */
export function watchAllVoted(
  awareness: Awareness,
  open: () => { id: string; votesPerPerson: number } | null,
  canClose: () => boolean,
  close: () => void,
): AllVotedWatch {
  let closing: string | null = null;
  const check = () => {
    if (!canClose()) return;
    const voting = open();
    if (!voting) {
      closing = null;
      return;
    }
    const voters = votersOf(awareness);
    const done =
      voters.length > 0 &&
      voters.every(
        (voter) => voter.votingId === voting.id && (voter.votes ?? 0) >= voting.votesPerPerson,
      );
    if (done && closing !== voting.id) {
      closing = voting.id;
      close();
    }
  };
  awareness.on('change', check);
  return {
    check,
    destroy: () => awareness.off('change', check),
  };
}
