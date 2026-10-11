import * as Y from 'yjs';
import { SESSION_MAP_KEY } from '../facilitation/timer';

/**
 * Comments on the board (#733): threads attached to an element or to a point, kept in the board's Yjs document in the
 * map `session`, under the key `comments`, next to the timer. Board state that every client needs at once, so ADR 0020's
 * reasoning for the document applies. Like the timer it is outside the Excalidraw binding: Ctrl+Z does not touch it and no
 * PNG, SVG or `.excalidraw` export contains it (the PDF export can append it, off by default).
 *
 * The state is made of **nested Yjs types**: a thread is a `Y.Map` and its messages a `Y.Array` of `Y.Map`, so two people
 * who reply at the same moment both stay (one plain object under one key would let the last writer win).
 *
 * Viewers can write here and nowhere else: the realtime service lets a viewer's update through when it touches only this map
 * (docs/specs/realtime.md). That makes authorship a rule of the interface, not an enforced one: the server cannot tell a
 * viewer's own message from another's, so "delete your own" and "owners delete any" are checks of this module's callers.
 */
export const COMMENTS_KEY = 'comments';

export const MAX_COMMENT_LENGTH = 2000;
/** Guards against a board that is filled with comments: the interface refuses more. */
export const MAX_THREADS = 500;
export const MAX_REPLIES_PER_THREAD = 200;

/** A thread hangs on an element (and follows it) or on a point of the board (and stays there). */
export type CommentAnchor = { elementId: string } | { x: number; y: number };

export interface CommentAuthor {
  id: string;
  name: string;
}

export interface CommentMessage {
  id: string;
  authorId: string;
  authorName: string;
  /** The text as stored: a mention is `@{userId}` and is shown as the person's name (see {@link renderText}). */
  text: string;
  createdAt: number;
  /** The ids mentioned in the text, for the notifications a later PBI adds. */
  mentions: string[];
  /** The names the mentioned ids had when the message was written, so every reader sees a name, whoever they can list. */
  mentionNames: Record<string, string>;
}

export interface CommentThread {
  id: string;
  anchor: CommentAnchor;
  createdAt: number;
  resolved: boolean;
  resolvedBy: CommentAuthor | null;
  /** The thread's messages, oldest first; the first one is the comment itself. */
  messages: CommentMessage[];
}

/** Why a change was refused. */
export type CommentRefusal = 'empty' | 'too-long' | 'unknown-thread' | 'too-many';

export class CommentError extends Error {
  constructor(readonly reason: CommentRefusal) {
    super(reason);
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function parseAnchor(raw: unknown): CommentAnchor | null {
  if (!isObject(raw)) return null;
  if (typeof raw['elementId'] === 'string' && raw['elementId'])
    return { elementId: raw['elementId'] };
  if (isFiniteNumber(raw['x']) && isFiniteNumber(raw['y'])) return { x: raw['x'], y: raw['y'] };
  return null;
}

function parseMessage(raw: unknown): CommentMessage | null {
  if (!isObject(raw)) return null;
  if (
    typeof raw['id'] !== 'string' ||
    typeof raw['authorId'] !== 'string' ||
    typeof raw['authorName'] !== 'string' ||
    typeof raw['text'] !== 'string' ||
    !isFiniteNumber(raw['createdAt'])
  ) {
    return null;
  }
  const mentions = Array.isArray(raw['mentions'])
    ? raw['mentions'].filter((id): id is string => typeof id === 'string')
    : [];
  const mentionNames: Record<string, string> = {};
  if (isObject(raw['mentionNames'])) {
    for (const [id, name] of Object.entries(raw['mentionNames'])) {
      if (typeof name === 'string') mentionNames[id] = name.slice(0, 120);
    }
  }
  return {
    id: raw['id'],
    authorId: raw['authorId'],
    authorName: raw['authorName'],
    // Another client wrote this: it is cut to the limit rather than trusted.
    text: raw['text'].slice(0, MAX_COMMENT_LENGTH),
    createdAt: raw['createdAt'],
    mentions,
    mentionNames,
  };
}

/** A stored thread as plain data, or `null` when it is not one (another client, or an older version, wrote it). */
export function parseThread(id: string, raw: unknown): CommentThread | null {
  if (!isObject(raw)) return null;
  const anchor = parseAnchor(raw['anchor']);
  if (!anchor || !isFiniteNumber(raw['createdAt']) || !Array.isArray(raw['replies'])) return null;
  // Replies written at the same moment arrive in the order of the clients' ids: by time, so every client shows the same.
  const messages = raw['replies']
    .map(parseMessage)
    .filter((message): message is CommentMessage => message !== null)
    .sort((a, b) => a.createdAt - b.createdAt);
  if (messages.length === 0) return null;
  const by = raw['resolvedBy'];
  return {
    id,
    anchor,
    createdAt: raw['createdAt'],
    resolved: raw['resolved'] === true,
    resolvedBy:
      isObject(by) && typeof by['id'] === 'string' && typeof by['name'] === 'string'
        ? { id: by['id'], name: by['name'] }
        : null,
    messages,
  };
}

function commentsMap(doc: Y.Doc): Y.Map<unknown> | null {
  const comments = doc.getMap<unknown>(SESSION_MAP_KEY).get(COMMENTS_KEY);
  return comments instanceof Y.Map ? comments : null;
}

/** The threads of the board, unresolved first, then by when they were started (oldest first). */
export function readThreads(doc: Y.Doc): CommentThread[] {
  const threads: CommentThread[] = [];
  commentsMap(doc)?.forEach((value, id) => {
    const thread = value instanceof Y.Map ? parseThread(id, value.toJSON()) : null;
    if (thread) threads.push(thread);
  });
  return threads.sort(
    (a, b) =>
      Number(a.resolved) - Number(b.resolved) ||
      a.createdAt - b.createdAt ||
      a.id.localeCompare(b.id),
  );
}

/**
 * Makes sure the map exists. Two clients that create it at the same moment each get a map and one of them wins, so the
 * editors do it when they connect (before anybody has a reason to comment); a viewer creates it only when nobody did.
 */
export function ensureComments(doc: Y.Doc): Y.Map<unknown> {
  const existing = commentsMap(doc);
  if (existing) return existing;
  const created = new Y.Map<unknown>();
  doc.getMap<unknown>(SESSION_MAP_KEY).set(COMMENTS_KEY, created);
  return created;
}

/** The text of a message to store: trimmed, and refused when empty or longer than {@link MAX_COMMENT_LENGTH}. */
export function checkText(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '') throw new CommentError('empty');
  if (trimmed.length > MAX_COMMENT_LENGTH) throw new CommentError('too-long');
  return trimmed;
}

const MENTION = /@\{([^{}\s]{1,128})\}/g;

/** The ids mentioned in a stored text, once each, in order. */
export function mentionsIn(text: string): string[] {
  return [...new Set([...text.matchAll(MENTION)].map((match) => match[1]))];
}

/**
 * A stored text as it is shown: every `@{id}` becomes `@Name`. An id nobody knows is shown as `@?` rather than as the id,
 * which means nothing to a reader.
 */
export function renderText(text: string, names: ReadonlyMap<string, string>): string {
  return text.replace(MENTION, (_all, id: string) => `@${names.get(id) ?? '?'}`);
}

/**
 * What a person typed as a stored text: every `@Name` they picked from the list becomes `@{id}`. The longest names are
 * replaced first, so `@Ann Lee` is not read as `@Ann`.
 */
export function storeText(typed: string, picked: ReadonlyMap<string, string>): string {
  let result = typed;
  const names = [...picked.keys()].sort((a, b) => b.length - a.length);
  for (const name of names) {
    result = result.split(`@${name}`).join(`@{${picked.get(name)}}`);
  }
  return result;
}

/** Who is mentioned in a message and what they are called: the id to name map, cut down to the ids the text mentions. */
export type MentionNames = Readonly<Record<string, string>>;

function newMessage(
  text: string,
  author: CommentAuthor,
  now: number,
  names: MentionNames = {},
): Y.Map<unknown> {
  const stored = checkText(text);
  const message = new Y.Map<unknown>();
  message.set('id', crypto.randomUUID());
  message.set('authorId', author.id);
  message.set('authorName', author.name);
  message.set('text', stored);
  message.set('createdAt', now);
  const mentions = mentionsIn(stored);
  message.set('mentions', mentions);
  message.set(
    'mentionNames',
    Object.fromEntries(mentions.flatMap((id) => (names[id] ? [[id, names[id]]] : []))),
  );
  return message;
}

/** Starts a thread with its first message; returns the thread's id. */
export function addThread(
  doc: Y.Doc,
  anchor: CommentAnchor,
  text: string,
  author: CommentAuthor,
  now: number = Date.now(),
  names: MentionNames = {},
): string {
  const id = crypto.randomUUID();
  doc.transact(() => {
    const comments = ensureComments(doc);
    if (comments.size >= MAX_THREADS) throw new CommentError('too-many');
    const thread = new Y.Map<unknown>();
    comments.set(id, thread);
    thread.set('id', id);
    thread.set('anchor', anchor);
    thread.set('createdAt', now);
    thread.set('resolved', false);
    thread.set('resolvedBy', null);
    const replies = new Y.Array<Y.Map<unknown>>();
    thread.set('replies', replies);
    replies.push([newMessage(text, author, now, names)]);
  });
  return id;
}

function threadOf(doc: Y.Doc, threadId: string): Y.Map<unknown> {
  const thread = commentsMap(doc)?.get(threadId);
  if (!(thread instanceof Y.Map)) throw new CommentError('unknown-thread');
  return thread;
}

/** Adds a message to a thread. */
export function addReply(
  doc: Y.Doc,
  threadId: string,
  text: string,
  author: CommentAuthor,
  now: number = Date.now(),
  names: MentionNames = {},
): void {
  doc.transact(() => {
    const thread = threadOf(doc, threadId);
    const replies = thread.get('replies') as Y.Array<Y.Map<unknown>>;
    if (replies.length >= MAX_REPLIES_PER_THREAD) throw new CommentError('too-many');
    replies.push([newMessage(text, author, now, names)]);
  });
}

/** Marks a thread resolved, or opens it again (`resolved` false). */
export function setResolved(
  doc: Y.Doc,
  threadId: string,
  resolved: boolean,
  by: CommentAuthor,
): void {
  doc.transact(() => {
    const thread = threadOf(doc, threadId);
    thread.set('resolved', resolved);
    thread.set('resolvedBy', resolved ? { id: by.id, name: by.name } : null);
  });
}

/** Removes one message; the thread goes with its last message. `false` when there was no such message. */
export function deleteMessage(doc: Y.Doc, threadId: string, messageId: string): boolean {
  let done = false;
  doc.transact(() => {
    const comments = commentsMap(doc);
    const thread = comments?.get(threadId);
    if (!(thread instanceof Y.Map)) return;
    const replies = thread.get('replies') as Y.Array<Y.Map<unknown>>;
    const index = replies.toArray().findIndex((reply) => reply.get('id') === messageId);
    if (index < 0) return;
    if (replies.length === 1) comments!.delete(threadId);
    else replies.delete(index, 1);
    done = true;
  });
  return done;
}

/** Whether a person may delete a message: their own, or any when they moderate (the board's owner). A rule of the interface. */
export function canDeleteMessage(
  message: Pick<CommentMessage, 'authorId'>,
  userId: string,
  moderate: boolean,
): boolean {
  return moderate || message.authorId === userId;
}

/** Everything the interface needs to know about the threads at a glance. */
export function countThreads(threads: readonly CommentThread[]): {
  total: number;
  unresolved: number;
} {
  return { total: threads.length, unresolved: threads.filter((thread) => !thread.resolved).length };
}

/** The names the board knows for ids: the authors of the messages and the names kept with mentions, then the people the host listed (which win). */
export function knownNames(
  threads: readonly CommentThread[],
  directory: readonly { id: string; name: string }[],
): Map<string, string> {
  const names = new Map<string, string>();
  for (const thread of threads) {
    for (const message of thread.messages) {
      names.set(message.authorId, message.authorName);
      for (const [id, name] of Object.entries(message.mentionNames)) names.set(id, name);
    }
  }
  for (const person of directory) names.set(person.id, person.name);
  return names;
}

export interface CommentsSync {
  /** The current threads. */
  read(): CommentThread[];
  destroy(): void;
}

/**
 * Watches the comments of a document and calls `onChange` with the threads when they changed, here or on another client.
 * A change of the timer, which shares the map `session`, is not announced.
 */
export function observeComments(
  doc: Y.Doc,
  onChange: (threads: CommentThread[]) => void,
): CommentsSync {
  const root = doc.getMap<unknown>(SESSION_MAP_KEY);
  let last = JSON.stringify(readThreads(doc));
  const check = () => {
    const threads = readThreads(doc);
    const json = JSON.stringify(threads);
    if (json === last) return;
    last = json;
    onChange(threads);
  };
  root.observeDeep(check);
  return {
    read: () => readThreads(doc),
    destroy: () => root.unobserveDeep(check),
  };
}
