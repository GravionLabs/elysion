import type { Messages } from '../i18n';
import { renderText, type CommentAnchor, type CommentThread } from './comments';
import type { PdfAppendix } from '../pdf';

/**
 * The comments as the appendix of a PDF export (#733, off by default): a page of text with the open threads first, then the
 * resolved ones. `describe` says what a thread hangs on in words; `null` when the thread has no element any more.
 */
export function buildAppendix(
  threads: readonly CommentThread[],
  names: ReadonlyMap<string, string>,
  t: Messages,
  locale: string,
  describe: (anchor: CommentAnchor) => string | null,
): PdfAppendix | null {
  if (threads.length === 0) return null;
  const format = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const section = (heading: string, list: readonly CommentThread[]) => ({
    heading,
    threads: list.map((thread) => {
      const label = describe(thread.anchor);
      return {
        where:
          'elementId' in thread.anchor
            ? label === null
              ? t.commentElementGone
              : t.commentsAppendixOnElement(label)
            : t.commentsAppendixOnPoint,
        resolvedBy: thread.resolvedBy ? t.commentResolvedBy(thread.resolvedBy.name) : undefined,
        messages: thread.messages.map((message) => ({
          author: message.authorName,
          date: format.format(message.createdAt),
          text: renderText(message.text, names),
        })),
      };
    }),
  });
  const open = threads.filter((thread) => !thread.resolved);
  const resolved = threads.filter((thread) => thread.resolved);
  return {
    title: t.commentsAppendixTitle,
    sections: [
      ...(open.length ? [section(t.commentsAppendixOpen, open)] : []),
      ...(resolved.length ? [section(t.commentsAppendixResolved, resolved)] : []),
    ],
  };
}
