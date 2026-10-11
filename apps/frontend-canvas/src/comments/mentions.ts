/** A person who can be mentioned: the identity provider's id and the name shown. */
export interface Person {
  id: string;
  name: string;
}

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
