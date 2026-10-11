import type { ApiVoting, VotingApi } from './voting';

/**
 * A `VotingApi` for tests: one person's view of a voting kept in memory, with the rules of the server (ADR 0029) that the
 * canvas relies on. `viewer` is the one calling; `others` adds votes of other people to the result.
 */
export function fakeVotingApi(options: { me?: { id: string; name: string } } = {}) {
  const me = options.me ?? { id: 'u-me', name: 'Me' };
  const sessions: Array<{
    id: string;
    name: string;
    votesPerPerson: number;
    named: boolean;
    status: 'open' | 'closed';
    votes: string[];
  }> = [];
  const view = (index: number): ApiVoting => {
    const s = sessions[index];
    const mine: Record<string, number> = {};
    for (const id of s.votes) mine[id] = (mine[id] ?? 0) + 1;
    return {
      id: s.id,
      name: s.name,
      votesPerPerson: s.votesPerPerson,
      status: s.status,
      named: s.named,
      startedBy: me,
      myVotes: s.votes.length,
      myElementVotes: s.status === 'open' ? mine : {},
      ...(s.status === 'open'
        ? { placed: { [me.id]: s.votes.length } }
        : {
            result: Object.entries(mine).map(([elementId, count]) => ({
              elementId,
              count,
              ...(s.named ? { voters: [me] } : {}),
            })),
          }),
    };
  };
  const open = () => sessions.findIndex((s) => s.status === 'open');
  const find = (id: string) => sessions.findIndex((s) => s.id === id);
  const api: VotingApi = {
    get: () => {
      const index = open() >= 0 ? open() : sessions.length - 1;
      return Promise.resolve(index >= 0 ? view(index) : null);
    },
    start: (o) => {
      if (open() >= 0) return Promise.reject(new Error('A voting is already open.'));
      sessions.push({
        id: crypto.randomUUID(),
        name: o.name ?? 'Voting',
        votesPerPerson: o.votesPerPerson,
        named: o.named === true,
        status: 'open',
        votes: [],
      });
      return Promise.resolve(view(sessions.length - 1));
    },
    vote: (id, elementId) => {
      const index = find(id);
      const s = sessions[index];
      if (!s || s.status !== 'open' || s.votes.length >= s.votesPerPerson)
        return Promise.reject(new Error('409'));
      s.votes.push(elementId);
      return Promise.resolve(view(index));
    },
    retract: (id, elementId) => {
      const index = find(id);
      const s = sessions[index];
      if (!s || s.status !== 'open') return Promise.reject(new Error('409'));
      const at = s.votes.lastIndexOf(elementId);
      if (at < 0) return Promise.resolve(null);
      s.votes.splice(at, 1);
      return Promise.resolve(view(index));
    },
    close: (id) => {
      const index = find(id);
      if (index < 0) return Promise.reject(new Error('404'));
      sessions[index].status = 'closed';
      return Promise.resolve(view(index));
    },
    clear: () => {
      for (let i = sessions.length - 1; i >= 0; i--)
        if (sessions[i].status === 'closed') sessions.splice(i, 1);
      return Promise.resolve();
    },
  };
  return { api, sessions };
}
