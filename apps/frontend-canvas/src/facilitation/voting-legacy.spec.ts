import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { dropLegacyVoting } from './voting-legacy';

/** The `voting` key as ADR 0020 wrote it: nested Yjs types. */
function legacyDoc(options: { open: boolean }) {
  const doc = new Y.Doc();
  const elements = doc.getMap<unknown>('elements');
  elements.set('a', { id: 'a', type: 'text', text: 'Alpha' });
  elements.set('b', { id: 'b', type: 'text', text: 'Beta', isDeleted: true });
  const root = doc.getMap<unknown>('session');
  const voting = new Y.Map<unknown>();
  root.set('voting', voting);
  const sessions = new Y.Map<unknown>();
  voting.set('sessions', sessions);
  const session = new Y.Map<unknown>();
  sessions.set('s1', session);
  session.set('name', 'Old pick');
  session.set('status', options.open ? 'open' : 'closed');
  const votes = new Y.Map<unknown>();
  session.set('votes', votes);
  const list = new Y.Array<string>();
  list.push(['a', 'a', 'b']);
  votes.set('u1', list);
  voting.set('openSessionId', options.open ? 's1' : null);
  return doc;
}

describe('dropLegacyVoting', () => {
  it('does nothing without the old key', () => {
    expect(dropLegacyVoting(new Y.Doc())).toBeNull();
  });

  it('reports the counts of a voting that was open and removes the key', () => {
    const doc = legacyDoc({ open: true });

    expect(dropLegacyVoting(doc)).toEqual({
      name: 'Old pick',
      top: [{ label: 'Alpha', count: 2 }],
    });
    expect(doc.getMap('session').has('voting')).toBe(false);
  });

  it('drops closed votings without a message', () => {
    const doc = legacyDoc({ open: false });

    expect(dropLegacyVoting(doc)).toBeNull();
    expect(doc.getMap('session').has('voting')).toBe(false);
  });
});
