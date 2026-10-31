import * as Y from 'yjs';

/** The root map that holds the board's shared facilitation state (timer, agenda, presenter, comments); the elements are a root map of their own. */
export const SESSION_MAP_KEY = 'session';

/** The key of `session` a viewer may write under: the comment threads (#733). */
export const COMMENTS_KEY = 'comments';

/**
 * Whether a viewer's Yjs update may be applied to the board (#733). A viewer's connection is read-only except for the
 * comment threads: the update is accepted only when everything it changes is the map `session.comments` or a type
 * inside it, and the only change it makes to `session` itself is creating `comments` when there is none yet. Anything
 * else (an element, the timer, the agenda, another root type, replacing or deleting `comments`) refuses the whole update, so a
 * mixed update cannot smuggle a change in beside a comment.
 *
 * It is decided on a scratch copy: the update is applied to a copy of `doc`'s state and the changes of that
 * transaction are read, which is the only way to know what an update does (its structs name their parents by
 * reference, not by path). An update that cannot be applied completely yet (it refers to structs the document does not
 * have, or deletes ones it does not have) leaves pending structs behind and is refused rather than held: a client
 * that is in step with the board never sends one, and a held struct could change something else once it resolves.
 *
 * The copy costs as much as encoding the document once, so this is called for viewers only, and only for the
 * messages that write; the size limits of the gateway apply before it.
 */
export function viewerMayApply(doc: Y.Doc, update: Uint8Array): boolean {
  const scratch = new Y.Doc();
  try {
    Y.applyUpdate(scratch, Y.encodeStateAsUpdate(doc));
    const session = scratch.getMap<unknown>(SESSION_MAP_KEY);
    const hadComments = session.has(COMMENTS_KEY);
    const comments = hadComments ? session.get(COMMENTS_KEY) : undefined;

    let allowed = true;
    scratch.on('afterTransaction', (transaction: Y.Transaction) => {
      for (const [type, keys] of transaction.changed) {
        if ((type as unknown) === session) {
          // Only creating `comments` (when there was none) changes `session` itself.
          const onlyComments = [...keys].every((key) => key === COMMENTS_KEY);
          if (!onlyComments || hadComments) allowed = false;
        } else if (!isInside(type, comments ?? session.get(COMMENTS_KEY))) {
          allowed = false;
        }
      }
    });
    Y.applyUpdate(scratch, update);

    if (scratch.store.pendingStructs !== null || scratch.store.pendingDs !== null) return false;
    // A created `comments` must be a map: a viewer may not put a value of another kind under the key.
    if (
      !hadComments &&
      session.has(COMMENTS_KEY) &&
      !(session.get(COMMENTS_KEY) instanceof Y.Map)
    ) {
      return false;
    }
    return allowed;
  } catch {
    return false;
  } finally {
    scratch.destroy();
  }
}

/** The part of a Yjs type that the walk up to the root needs. */
interface Nested {
  _item: { parent: unknown } | null;
}

/** Whether `type` is `root` or lies below it. */
function isInside(type: unknown, root: unknown): boolean {
  if (!(root instanceof Y.Map)) return false;
  let current: unknown = type;
  while (current) {
    if (current === root) return true;
    current = (current as Nested)._item?.parent ?? null;
  }
  return false;
}
