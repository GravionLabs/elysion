import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useI18n, type Messages } from '../i18n';
import {
  CommentError,
  MAX_COMMENT_LENGTH,
  canDeleteMessage,
  renderText,
  storeText,
  type CommentAnchor,
  type CommentAuthor,
  type CommentThread,
  type MentionNames,
} from './comments';
import { activeMention, applyMention, suggestions, type Person } from './mentions';

export interface CommentPanelProps {
  threads: readonly CommentThread[];
  me: CommentAuthor;
  /** The board's owner deletes any message; everybody else only their own (a rule of the interface, see comments.ts). */
  moderate: boolean;
  /** Where a new comment is being written, or `null`. */
  pending: CommentAnchor | null;
  /** The thread a marker was clicked for: drawn out and scrolled to. */
  activeId: string | null;
  /** The people `@` offers. */
  directory: readonly Person[];
  /** The names of every id the texts mention. */
  names: ReadonlyMap<string, string>;
  /** What a thread hangs on, in words ("Sticky note: Ship it"), or `null` when the element is gone. */
  describeAnchor: (anchor: CommentAnchor) => string | null;
  /** Each throws a {@link CommentError} when the change is refused. */
  onStart: (text: string, mentionNames: MentionNames) => void;
  onReply: (threadId: string, text: string, mentionNames: MentionNames) => void;
  onResolve: (threadId: string, resolved: boolean) => void;
  onDelete: (threadId: string, messageId: string) => void;
  /** Wants to place a new comment: the tool is armed again. */
  onNew: () => void;
  onCancelNew: () => void;
  onShow: (threadId: string) => void;
  onClose: () => void;
  /** The tool is armed and waiting for a click. */
  placing: boolean;
}

function problemText(error: unknown, t: Messages): string {
  if (error instanceof CommentError) {
    if (error.reason === 'too-long') return t.commentTooLong(MAX_COMMENT_LENGTH);
    if (error.reason === 'too-many') return t.commentTooMany;
  }
  return t.commentFailed;
}

interface ComposerProps {
  placeholder: string;
  sendLabel: string;
  directory: readonly Person[];
  autoFocus?: boolean;
  onSubmit: (stored: string, mentionNames: MentionNames) => void;
  onCancel?: () => void;
}

/** A text box for one message: `@` offers the people, and what is stored has their ids instead of their names. */
function Composer({
  placeholder,
  sendLabel,
  directory,
  autoFocus,
  onSubmit,
  onCancel,
}: ComposerProps) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [picked, setPicked] = useState<ReadonlyMap<string, string>>(new Map());
  const [highlight, setHighlight] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const listId = useId();

  const mention = useMemo(() => activeMention(text, caret), [text, caret]);
  const options = useMemo(
    () => (mention && !dismissed ? suggestions(directory, mention.query) : []),
    [mention, dismissed, directory],
  );
  const open = options.length > 0;

  useEffect(() => {
    if (autoFocus) field.current?.focus();
  }, [autoFocus]);

  const choose = (person: Person) => {
    if (!mention) return;
    const next = applyMention(text, caret, mention, person);
    setText(next.text);
    setCaret(next.caret);
    setPicked(new Map(picked).set(person.name, person.id));
    setHighlight(0);
    setDismissed(true); // "@Name " would still read as a mention in progress (names have spaces); typing opens the list again
    requestAnimationFrame(() => {
      field.current?.focus();
      field.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  const left = MAX_COMMENT_LENGTH - text.length;
  const send = () => {
    if (!text.trim() || left < 0) return;
    try {
      const stored = storeText(text, picked);
      onSubmit(stored, Object.fromEntries([...picked].map(([name, id]) => [id, name])));
      setText('');
      setCaret(0);
      setPicked(new Map());
      setError(null);
    } catch (problem) {
      setError(problemText(problem, t));
    }
  };

  return (
    <div className="elysion-comment-composer">
      <textarea
        ref={field}
        rows={3}
        value={text}
        placeholder={placeholder}
        aria-label={placeholder}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${highlight}` : undefined}
        onChange={(event) => {
          setText(event.target.value);
          setCaret(event.target.selectionStart);
          setDismissed(false);
          setHighlight(0);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={(event) => {
          event.stopPropagation(); // typing is not a shortcut of the canvas
          if (open) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const step = event.key === 'ArrowDown' ? 1 : options.length - 1;
              setHighlight((highlight + step) % options.length);
              return;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault();
              choose(options[Math.min(highlight, options.length - 1)]);
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              setDismissed(true);
              return;
            }
          }
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            send();
          } else if (event.key === 'Escape' && onCancel) {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      {open && (
        <ul
          id={listId}
          className="elysion-comment-mentions"
          role="listbox"
          aria-label={t.commentMentions}
        >
          {options.map((person, index) => (
            <li
              key={person.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === highlight}
              className={index === highlight ? 'active' : undefined}
              onMouseDown={(event) => {
                event.preventDefault(); // the text box keeps its focus
                choose(person);
              }}
            >
              {person.name}
            </li>
          ))}
        </ul>
      )}
      {(left < 200 || error) && (
        <p
          className={left < 0 || error ? 'elysion-comment-note error' : 'elysion-comment-note'}
          role="status"
        >
          {error ??
            (left < 0 ? t.commentTooLong(MAX_COMMENT_LENGTH) : t.commentCharactersLeft(left))}
        </p>
      )}
      <div className="elysion-comment-actions">
        <button
          type="button"
          className="elysion-comment-button primary"
          disabled={!text.trim() || left < 0}
          onClick={send}
        >
          {sendLabel}
        </button>
        {onCancel && (
          <button type="button" className="elysion-comment-button" onClick={onCancel}>
            {t.commentCancel}
          </button>
        )}
      </div>
    </div>
  );
}

function ThreadCard({ thread, props }: { thread: CommentThread; props: CommentPanelProps }) {
  const { t, locale } = useI18n();
  const { me, moderate, names, activeId } = props;
  const card = useRef<HTMLLIElement>(null);
  const active = activeId === thread.id;
  const where = props.describeAnchor(thread.anchor);
  const format = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale],
  );

  useEffect(() => {
    if (active) card.current?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  return (
    <li
      ref={card}
      className={[
        'elysion-comment-thread',
        thread.resolved ? 'resolved' : '',
        active ? 'active' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-comment-thread={thread.id}
    >
      <button
        type="button"
        className="elysion-comment-where"
        title={t.commentShow}
        onClick={() => props.onShow(thread.id)}
      >
        {where ?? ('elementId' in thread.anchor ? t.commentElementGone : t.commentOnPoint)}
      </button>
      <ul className="elysion-comment-messages">
        {thread.messages.map((message) => (
          <li key={message.id} data-comment-message={message.id}>
            <div className="elysion-comment-meta">
              <strong>{message.authorName}</strong>
              <time dateTime={new Date(message.createdAt).toISOString()}>
                {format.format(message.createdAt)}
              </time>
              {canDeleteMessage(message, me.id, moderate) && (
                <button
                  type="button"
                  className="elysion-comment-link"
                  aria-label={t.commentDeleteLabel(message.authorName)}
                  onClick={() => props.onDelete(thread.id, message.id)}
                >
                  {t.commentDelete}
                </button>
              )}
            </div>
            <p className="elysion-comment-text">{renderText(message.text, names)}</p>
          </li>
        ))}
      </ul>
      {thread.resolved && thread.resolvedBy && (
        <p className="elysion-comment-note">{t.commentResolvedBy(thread.resolvedBy.name)}</p>
      )}
      {!thread.resolved && (
        <Composer
          placeholder={t.replyPlaceholder}
          sendLabel={t.replySend}
          directory={props.directory}
          onSubmit={(text, mentioned) => props.onReply(thread.id, text, mentioned)}
        />
      )}
      <div className="elysion-comment-actions">
        <button
          type="button"
          className="elysion-comment-button"
          onClick={() => props.onResolve(thread.id, !thread.resolved)}
        >
          {thread.resolved ? t.commentReopen : t.commentResolve}
        </button>
      </div>
    </li>
  );
}

/**
 * The side panel of the comments (#733): the threads, unresolved first, each with its messages, a reply box, Resolve or Reopen
 * and Delete; and the box for a new comment once a place was clicked. Viewers have all of it: their writes to the comments are
 * the one thing the realtime service lets through.
 */
export function CommentPanel(props: CommentPanelProps) {
  const { t } = useI18n();
  const { threads, pending } = props;
  const open = threads.filter((thread) => !thread.resolved);
  const resolved = threads.filter((thread) => thread.resolved);
  const headingId = useId();

  return (
    <aside
      className="elysion-comments"
      aria-labelledby={headingId}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) props.onClose();
      }}
    >
      <header className="elysion-comments__header">
        <h2 id={headingId}>{t.commentsPanel}</h2>
        {!pending && (
          <button
            type="button"
            className="elysion-comment-button"
            aria-pressed={props.placing}
            onClick={props.onNew}
          >
            {t.commentsNew}
          </button>
        )}
        <button
          type="button"
          className="elysion-comment-close"
          aria-label={t.commentsClose}
          onClick={props.onClose}
        >
          ×
        </button>
      </header>
      <div className="elysion-comments__body">
        {pending && (
          <section className="elysion-comment-new" aria-label={t.commentsNew}>
            <p className="elysion-comment-where static">
              {props.describeAnchor(pending) ??
                ('elementId' in pending ? t.commentOnElement : t.commentOnPoint)}
            </p>
            <Composer
              autoFocus
              placeholder={t.commentPlaceholder}
              sendLabel={t.commentSend}
              directory={props.directory}
              onSubmit={props.onStart}
              onCancel={props.onCancelNew}
            />
          </section>
        )}
        {props.placing && !pending && (
          <p className="elysion-comment-note" role="status">
            {t.commentsPlaceHint}
          </p>
        )}
        {threads.length === 0 && !pending && !props.placing && (
          <p className="elysion-comment-note">{t.commentsEmpty}</p>
        )}
        {open.length > 0 && (
          <section aria-label={t.commentsOpenHeading(open.length)}>
            <h3>{t.commentsOpenHeading(open.length)}</h3>
            <ul className="elysion-comment-threads">
              {open.map((thread) => (
                <ThreadCard key={thread.id} thread={thread} props={props} />
              ))}
            </ul>
          </section>
        )}
        {resolved.length > 0 && (
          <section aria-label={t.commentsResolvedHeading(resolved.length)}>
            <h3>{t.commentsResolvedHeading(resolved.length)}</h3>
            <ul className="elysion-comment-threads">
              {resolved.map((thread) => (
                <ThreadCard key={thread.id} thread={thread} props={props} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
}
