import * as Y from 'yjs';
import { describe, expect, it, vi } from 'vitest';
import { SESSION_MAP_KEY } from '../facilitation/timer';
import {
  CommentError,
  MAX_COMMENT_LENGTH,
  MAX_REPLIES_PER_THREAD,
  MAX_THREADS,
  addReply,
  addThread,
  canDeleteMessage,
  checkText,
  countThreads,
  deleteMessage,
  ensureComments,
  knownNames,
  mentionsIn,
  observeComments,
  parseThread,
  readThreads,
  renderText,
  setResolved,
  storeText,
} from './comments';

const ann = { id: 'u-ann', name: 'Ann' };
const bob = { id: 'u-bob', name: 'Bob' };

/** Brings two documents to the same state, as the server does for two clients. */
function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
}

describe('threads', () => {
  it('starts a thread with its first message on an element', () => {
    const doc = new Y.Doc();

    const id = addThread(doc, { elementId: 'e1' }, '  Why this one?  ', ann, 1000);

    expect(readThreads(doc)).toEqual([
      {
        id,
        anchor: { elementId: 'e1' },
        createdAt: 1000,
        resolved: false,
        resolvedBy: null,
        messages: [
          {
            id: expect.any(String),
            authorId: 'u-ann',
            authorName: 'Ann',
            text: 'Why this one?',
            createdAt: 1000,
            mentions: [],
            mentionNames: {},
          },
        ],
      },
    ]);
  });

  it('keeps a point anchor as it is', () => {
    const doc = new Y.Doc();
    addThread(doc, { x: 12.5, y: -3 }, 'Here', ann);
    expect(readThreads(doc)[0].anchor).toEqual({ x: 12.5, y: -3 });
  });

  it('lists unresolved threads first, then by age', () => {
    const doc = new Y.Doc();
    const first = addThread(doc, { elementId: 'a' }, 'one', ann, 1);
    const second = addThread(doc, { elementId: 'b' }, 'two', ann, 2);
    const third = addThread(doc, { elementId: 'c' }, 'three', ann, 3);

    setResolved(doc, first, true, bob);

    expect(readThreads(doc).map((thread) => thread.id)).toEqual([second, third, first]);
  });

  it('resolves and reopens, and remembers who resolved', () => {
    const doc = new Y.Doc();
    const id = addThread(doc, { elementId: 'a' }, 'one', ann);

    setResolved(doc, id, true, bob);
    expect(readThreads(doc)[0]).toMatchObject({ resolved: true, resolvedBy: bob });

    setResolved(doc, id, false, ann);
    expect(readThreads(doc)[0]).toMatchObject({ resolved: false, resolvedBy: null });
  });

  it('adds replies in order', () => {
    const doc = new Y.Doc();
    const id = addThread(doc, { elementId: 'a' }, 'one', ann, 1);

    addReply(doc, id, 'two', bob, 2);

    expect(readThreads(doc)[0].messages.map((m) => [m.authorName, m.text])).toEqual([
      ['Ann', 'one'],
      ['Bob', 'two'],
    ]);
  });

  it('refuses an empty text, a text over the limit and a reply to a thread that is not there', () => {
    const doc = new Y.Doc();
    const id = addThread(doc, { elementId: 'a' }, 'one', ann);

    expect(() => addThread(doc, { elementId: 'a' }, '   ', ann)).toThrow(CommentError);
    expect(() => addReply(doc, id, 'x'.repeat(MAX_COMMENT_LENGTH + 1), bob)).toThrow(
      expect.objectContaining({ reason: 'too-long' }),
    );
    expect(() => addReply(doc, 'nope', 'hi', bob)).toThrow(
      expect.objectContaining({ reason: 'unknown-thread' }),
    );
    expect(() => addReply(doc, id, 'x'.repeat(MAX_COMMENT_LENGTH), bob)).not.toThrow();
    expect(readThreads(doc)).toHaveLength(1);
  });

  it('stops at the limits for threads and replies', () => {
    const doc = new Y.Doc();
    for (let i = 0; i < MAX_THREADS; i++) addThread(doc, { x: i, y: 0 }, 'c', ann);
    expect(() => addThread(doc, { x: 0, y: 0 }, 'c', ann)).toThrow(
      expect.objectContaining({ reason: 'too-many' }),
    );

    const other = new Y.Doc();
    const id = addThread(other, { x: 0, y: 0 }, 'c', ann);
    for (let i = 1; i < MAX_REPLIES_PER_THREAD; i++) addReply(other, id, 'r', bob);
    expect(() => addReply(other, id, 'r', bob)).toThrow(
      expect.objectContaining({ reason: 'too-many' }),
    );
  });

  it('removes a message, and the thread with its last one', () => {
    const doc = new Y.Doc();
    const id = addThread(doc, { elementId: 'a' }, 'one', ann);
    addReply(doc, id, 'two', bob);
    const [first, second] = readThreads(doc)[0].messages;

    expect(deleteMessage(doc, id, first.id)).toBe(true);
    expect(readThreads(doc)[0].messages.map((m) => m.id)).toEqual([second.id]);

    expect(deleteMessage(doc, id, second.id)).toBe(true);
    expect(readThreads(doc)).toEqual([]);
    expect(deleteMessage(doc, id, second.id)).toBe(false);
  });

  it('leaves out what is not a thread', () => {
    const doc = new Y.Doc();
    addThread(doc, { elementId: 'a' }, 'one', ann);
    (doc.getMap(SESSION_MAP_KEY).get('comments') as Y.Map<unknown>).set('junk', 'text');
    (doc.getMap(SESSION_MAP_KEY).get('comments') as Y.Map<unknown>).set('half', new Y.Map());

    expect(readThreads(doc)).toHaveLength(1);
    expect(parseThread('x', { anchor: { elementId: 'a' }, createdAt: 1, replies: [] })).toBeNull();
    expect(parseThread('x', null)).toBeNull();
  });

  it('cuts a text written by a client that ignored the limit', () => {
    const thread = parseThread('t', {
      anchor: { elementId: 'a' },
      createdAt: 1,
      resolved: false,
      replies: [
        {
          id: 'm',
          authorId: 'u',
          authorName: 'U',
          text: 'x'.repeat(MAX_COMMENT_LENGTH + 50),
          createdAt: 1,
        },
      ],
    });
    expect(thread?.messages[0].text).toHaveLength(MAX_COMMENT_LENGTH);
  });
});

describe('ensureComments', () => {
  it('makes the map once, so that a viewer only adds threads to it', () => {
    const doc = new Y.Doc();

    const first = ensureComments(doc);

    expect(ensureComments(doc)).toBe(first);
    expect(doc.getMap(SESSION_MAP_KEY).get('comments')).toBe(first);
    expect(readThreads(doc)).toEqual([]);
  });

  it('does not touch the timer next to it', () => {
    const doc = new Y.Doc();
    doc.getMap(SESSION_MAP_KEY).set('timer', { durationMs: 1 });
    ensureComments(doc);
    expect(doc.getMap(SESSION_MAP_KEY).get('timer')).toEqual({ durationMs: 1 });
  });
});

describe('two clients', () => {
  it('both keep their replies when they answer at the same moment', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const id = addThread(a, { elementId: 'e' }, 'question', ann, 1);
    sync(a, b);

    addReply(a, id, 'from ann', ann, 2);
    addReply(b, id, 'from bob', bob, 3);
    sync(a, b);

    for (const doc of [a, b]) {
      expect(readThreads(doc)[0].messages.map((m) => m.text)).toEqual([
        'question',
        'from ann',
        'from bob',
      ]);
    }
  });

  it('both keep their threads when they comment at the same moment, once the map exists', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    addThread(a, { elementId: 'e' }, 'first', ann, 1);
    sync(a, b);

    addThread(a, { elementId: 'x' }, 'from ann', ann, 2);
    addThread(b, { elementId: 'y' }, 'from bob', bob, 3);
    sync(a, b);

    expect(readThreads(a).map((t) => t.messages[0].text)).toEqual([
      'first',
      'from ann',
      'from bob',
    ]);
    expect(readThreads(b)).toEqual(readThreads(a));
  });
});

describe('observeComments', () => {
  it('announces a change made here or by another client, not the timer', () => {
    const doc = new Y.Doc();
    const onChange = vi.fn();
    const watch = observeComments(doc, onChange);

    addThread(doc, { elementId: 'a' }, 'one', ann);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toHaveLength(1);

    doc.getMap(SESSION_MAP_KEY).set('timer', { durationMs: 1 });
    expect(onChange).toHaveBeenCalledTimes(1);

    watch.destroy();
    addThread(doc, { elementId: 'b' }, 'two', ann);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('mentions', () => {
  const picked = new Map([
    ['Ann', 'u-ann'],
    ['Ann Lee', 'u-lee'],
  ]);

  it('stores the id of a picked name and shows the name again', () => {
    const stored = storeText('Please look, @Ann Lee and @Ann', picked);

    expect(stored).toBe('Please look, @{u-lee} and @{u-ann}');
    expect(mentionsIn(stored)).toEqual(['u-lee', 'u-ann']);
    expect(
      renderText(
        stored,
        new Map([
          ['u-lee', 'Ann Lee'],
          ['u-ann', 'Ann'],
        ]),
      ),
    ).toBe('Please look, @Ann Lee and @Ann');
  });

  it('shows @? for an id nobody knows and lists each mention once', () => {
    expect(renderText('hi @{gone}', new Map())).toBe('hi @?');
    expect(mentionsIn('@{a} @{a} @{b}')).toEqual(['a', 'b']);
  });

  it('keeps the mentions of a message, and the names they had, with the message', () => {
    const doc = new Y.Doc();
    addThread(doc, { elementId: 'a' }, 'see @{u-bob}', ann, 1, {
      'u-bob': 'Bob',
      'u-x': 'Not in the text',
    });
    const [message] = readThreads(doc)[0].messages;
    expect(message.mentions).toEqual(['u-bob']);
    expect(message.mentionNames).toEqual({ 'u-bob': 'Bob' });
    // Whoever reads it sees the name, whether or not they can list the people.
    expect(renderText(message.text, knownNames(readThreads(doc), []))).toBe('see @Bob');
  });

  it('knows the authors, and the directory wins', () => {
    const doc = new Y.Doc();
    addThread(doc, { elementId: 'a' }, 'one', ann);
    const names = knownNames(readThreads(doc), [{ id: 'u-ann', name: 'Ann Lee' }]);
    expect(names.get('u-ann')).toBe('Ann Lee');
  });
});

describe('rules of the interface', () => {
  it('lets a person delete their own message and an owner any', () => {
    expect(canDeleteMessage({ authorId: 'u-ann' }, 'u-ann', false)).toBe(true);
    expect(canDeleteMessage({ authorId: 'u-ann' }, 'u-bob', false)).toBe(false);
    expect(canDeleteMessage({ authorId: 'u-ann' }, 'u-bob', true)).toBe(true);
  });

  it('counts', () => {
    const doc = new Y.Doc();
    const id = addThread(doc, { elementId: 'a' }, 'one', ann);
    addThread(doc, { elementId: 'b' }, 'two', ann);
    setResolved(doc, id, true, ann);
    expect(countThreads(readThreads(doc))).toEqual({ total: 2, unresolved: 1 });
  });

  it('checks a text', () => {
    expect(checkText(' ok ')).toBe('ok');
    expect(() => checkText('')).toThrow(CommentError);
  });
});
