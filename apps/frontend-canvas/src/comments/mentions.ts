/** A person who can be mentioned: the identity provider's id and the name shown. */
export interface Person {
  id: string;
  name: string;
}

/** The host's search for people by what was typed (name or email), at least {@link MIN_SEARCH_LENGTH} characters. */
export type MentionSearch = (query: string) => Promise<readonly Person[]>;

/** The longest name part the list is filtered by: a name has a space or two, a sentence has no business in the list. */
const MAX_QUERY = 30;

/**
 * The `@` the caret is in the middle of, if any: where it starts and what was typed after it. An `@` counts only at the start
 * of the text or after a space, so an address (`name@example.com`) is no mention.
 */
export function activeMention(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = new RegExp(`(^|\\s)@([^@\\n]{0,${MAX_QUERY}})$`).exec(before);
  if (!match) return null;
  return { start: before.length - match[2].length - 1, query: match[2] };
}

/** The people whose name starts with what was typed (ignoring case), the best first, at most `max`. */
export function suggestions(directory: readonly Person[], query: string, max = 6): Person[] {
  const needle = query.trim().toLowerCase();
  const seen = new Set<string>();
  const result: Person[] = [];
  for (const person of directory) {
    if (seen.has(person.id) || !person.name.trim()) continue;
    seen.add(person.id);
    if (person.name.toLowerCase().startsWith(needle)) result.push(person);
  }
  for (const person of directory) {
    if (result.length >= max) break;
    if (result.includes(person) || !person.name.trim()) continue;
    if (!seen.has(person.id)) continue;
    if (needle && person.name.toLowerCase().includes(needle)) result.push(person);
  }
  return result.slice(0, max);
}

/** The text with the typed `@query` replaced by `@Name ` and the caret behind it. */
export function applyMention(
  text: string,
  caret: number,
  mention: { start: number },
  person: Person,
): { text: string; caret: number } {
  const inserted = `@${person.name} `;
  return {
    text: text.slice(0, mention.start) + inserted + text.slice(caret),
    caret: mention.start + inserted.length,
  };
}

/**
 * The people `@` offers: the local list filtered by what was typed, then what the host's search found (not filtered again: the
 * search may match an email address, and the name need not contain the query). A person listed twice, by id or by name, is
 * offered once. At most `max`.
 */
export function mergePeople(
  local: readonly Person[],
  found: readonly Person[],
  query: string,
  max = 8,
): Person[] {
  const result: Person[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  const add = (person: Person) => {
    const name = person.name.trim().toLowerCase();
    if (!name || ids.has(person.id) || names.has(name)) return;
    ids.add(person.id);
    names.add(name);
    result.push(person);
  };
  suggestions(local, query, max).forEach(add);
  found.forEach(add);
  return result.slice(0, max);
}

/** The shortest typed part that is searched for: as in the Share dialog, one letter would list half the directory. */
export const MIN_SEARCH_LENGTH = 2;

/** How long the typing rests before the host is asked. */
export const SEARCH_DELAY_MS = 200;
