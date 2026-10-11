import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { viewerMayApply } from './viewer-writes.js';

/** The board as the server has it: an element, a timer and (optionally) a comments map with one thread. */
function board(withComments = true): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('elements').set('e1', new Y.Map([['text', 'hello']]));
  const session = doc.getMap('session');
  session.set('timer', new Y.Map([['state', 'idle']]));
  if (withComments) {
    const thread = new Y.Map<unknown>();
    thread.set('text', 'first');
    thread.set('replies', new Y.Array());
    thread.set('resolved', false);
    const comments = new Y.Map<unknown>();
    comments.set('t1', thread);
    session.set('comments', comments);
  }
  return doc;
}

/** What a client that is in step with `server` sends after `change` ran on its copy. */
function updateOf(server: Y.Doc, change: (client: Y.Doc) => void): Uint8Array {
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
  const updates: Uint8Array[] = [];
  client.on('update', (u: Uint8Array) => updates.push(u));
  change(client);
  return updates.length > 0 ? Y.mergeUpdates(updates) : Y.encodeStateAsUpdate(new Y.Doc());
}

const comments = (doc: Y.Doc) => doc.getMap('session').get('comments') as Y.Map<unknown>;

describe('viewerMayApply', () => {
  it('accepts a new thread, a reply and a resolve inside the comments', () => {
    const server = board();
    expect(
      viewerMayApply(
        server,
        updateOf(server, (c) => {
          const thread = new Y.Map<unknown>();
          thread.set('text', 'second');
          comments(c).set('t2', thread);
        }),
      ),
    ).toBe(true);
    expect(
      viewerMayApply(
        server,
        updateOf(server, (c) =>
          ((comments(c).get('t1') as Y.Map<unknown>).get('replies') as Y.Array<unknown>).push([
            'a reply',
          ]),
        ),
      ),
    ).toBe(true);
    expect(
      viewerMayApply(
        server,
        updateOf(server, (c) => (comments(c).get('t1') as Y.Map<unknown>).set('resolved', true)),
      ),
    ).toBe(true);
  });

  it('accepts removing a thread and an update that changes nothing', () => {
    const server = board();
    expect(
      viewerMayApply(
        server,
        updateOf(server, (c) => comments(c).delete('t1')),
      ),
    ).toBe(true);
    expect(viewerMayApply(server, Y.encodeStateAsUpdate(server))).toBe(true);
    expect(
      viewerMayApply(
        server,
        updateOf(server, () => undefined),
      ),
    ).toBe(true);
  });

  it('accepts creating the comments map when the board has none', () => {
    const server = board(false);
    const update = updateOf(server, (c) => {
      const map = new Y.Map<unknown>();
      map.set('t1', new Y.Map([['text', 'hi']]));
      c.getMap('session').set('comments', map);
    });
    expect(viewerMayApply(server, update)).toBe(true);
  });

  it('refuses a change to an element', () => {
    const server = board();
    expect(
      viewerMayApply(
        server,
        updateOf(server, (c) =>
          (c.getMap('elements').get('e1') as Y.Map<unknown>).set('text', 'x'),
        ),
      ),
    ).toBe(false);
    expect(
      viewerMayApply(
        server,
        updateOf(server, (c) => c.getMap('elements').set('e2', new Y.Map())),
      ),
    ).toBe(false);
    expect(
      viewerMayApply(
        server,
        updateOf(server, (c) => c.getMap('elements').delete('e1')),
      ),
    ).toBe(false);
  });

  it('refuses a change to the timer, to another key of session or to another root type', () => {
    const server = board();
    expect(
      viewerMayApply(
        server,
        updateOf(server, (c) =>
          (c.getMap('session').get('timer') as Y.Map<unknown>).set('state', 'running'),
        ),
      ),
    ).toBe(false);
    expect(
      viewerMayApply(
        server,
        updateOf(server, (c) => c.getMap('session').set('voting', 'x')),
      ),
    ).toBe(false);
    expect(
      viewerMayApply(
        server,
        updateOf(server, (c) => c.getMap('session').delete('timer')),
      ),
    ).toBe(false);
    expect(
      viewerMayApply(
        server,
        updateOf(server, (c) => c.getMap('somewhere').set('a', 1)),
      ),
    ).toBe(false);
  });

  it('refuses to replace or delete the comments map itself, and to put something else under its key', () => {
    const server = board();
    expect(
      viewerMayApply(
        server,
        updateOf(server, (c) => c.getMap('session').set('comments', new Y.Map())),
      ),
    ).toBe(false);
    expect(
      viewerMayApply(
        server,
        updateOf(server, (c) => c.getMap('session').delete('comments')),
      ),
    ).toBe(false);
    const empty = board(false);
    expect(
      viewerMayApply(
        empty,
        updateOf(empty, (c) => c.getMap('session').set('comments', 'not a map')),
      ),
    ).toBe(false);
  });

  it('refuses a mixed update: a comment next to a forbidden change', () => {
    const server = board();
    const update = updateOf(server, (c) => {
      c.transact(() => {
        (comments(c).get('t1') as Y.Map<unknown>).set('resolved', true);
        c.getMap('elements').set('e2', new Y.Map());
      });
    });
    expect(viewerMayApply(server, update)).toBe(false);
  });

  it('refuses an update that refers to structs the board does not have, and garbage', () => {
    const server = board();
    const other = board();
    // `other` made its own content; an edit on top of a state `server` never saw cannot be applied completely.
    const lonely = new Y.Doc();
    Y.applyUpdate(lonely, Y.encodeStateAsUpdate(other));
    lonely.getMap('elements').set('only-here', new Y.Map());
    const updates: Uint8Array[] = [];
    lonely.on('update', (u: Uint8Array) => updates.push(u));
    (lonely.getMap('elements').get('only-here') as Y.Map<unknown>).set('a', 1);
    expect(viewerMayApply(new Y.Doc(), updates[0]!)).toBe(false);
    expect(viewerMayApply(server, new Uint8Array([1, 2, 3, 4, 5]))).toBe(false);
  });

  it('does not change the document it checks against', () => {
    const server = board();
    const before = Y.encodeStateAsUpdate(server);
    viewerMayApply(
      server,
      updateOf(server, (c) => comments(c).set('t9', new Y.Map())),
    );
    expect(Y.encodeStateAsUpdate(server)).toEqual(before);
  });
});
