import * as Y from 'yjs';
import { SESSION_MAP_KEY } from './timer';
import { type VotableElement, elementLabel } from './voting';

/** Before ADR 0029 the votes lived in the document, under this key of the `session` map. */
const LEGACY_VOTING_KEY = 'voting';

export interface LegacyOpenVoting {
  name: string;
  /** The most voted elements, with their labels. */
  top: Array<{ label: string; count: number }>;
}

/** The results shown in the notice: at most this many. */
const TOP = 5;

/**
 * The old `voting` key of the document (ADR 0029): a client that may write removes it when it finds it. The votes in it are
 * not carried over (votes are the server's now). A voting in it that was still open is reported, with its counts, so the
 * people who were in the middle of it see the result once. Returns what was open, or `null` when there was nothing to
 * report (no key, or only closed votings, which are dropped without a message).
 */
export function dropLegacyVoting(doc: Y.Doc): LegacyOpenVoting | null {
  const root = doc.getMap<unknown>(SESSION_MAP_KEY);
  const legacy = root.get(LEGACY_VOTING_KEY);
  if (legacy === undefined) return null;
  let result: LegacyOpenVoting | null = null;
  try {
    const json = (legacy instanceof Y.Map ? legacy.toJSON() : legacy) as {
      sessions?: Record<
        string,
        { name?: string; status?: string; votes?: Record<string, string[]> }
      >;
      openSessionId?: string | null;
    };
    const open = json?.openSessionId ? json.sessions?.[json.openSessionId] : undefined;
    if (open && open.status === 'open') {
      const elements = [...doc.getMap<unknown>('elements').values()] as VotableElement[];
      const alive = new Map(elements.filter((e) => !e.isDeleted).map((e) => [e.id, e]));
      const counts = new Map<string, number>();
      for (const list of Object.values(open.votes ?? {})) {
        for (const id of Array.isArray(list) ? list : []) {
          if (alive.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
        }
      }
      const top = [...counts.entries()]
        .map(([id, count]) => ({ label: elementLabel(alive.get(id)!, elements), count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
        .slice(0, TOP);
      result = { name: typeof open.name === 'string' ? open.name : '', top };
    }
  } catch {
    // Not what was written back then: it is dropped all the same.
  }
  root.delete(LEGACY_VOTING_KEY);
  return result;
}
