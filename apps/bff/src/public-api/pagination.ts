import { BadRequestException } from '@nestjs/common';

/** How many items a page has when the caller does not say (ADR 0033: at most 200). */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/** One page of a list of the public API: the items and the cursor of the next page, `null` on the last one. */
export interface Page<T> {
  items: T[];
  next: string | null;
}

/** The sort key of an item: compared component by component, each in its own direction. */
export type SortKey = Array<string | number>;

export interface Ordering<T> {
  /** The sort key of an item; it must be unique (end it with the id). */
  key: (item: T) => SortKey;
  /** The direction of each component of the key. */
  directions: Array<'asc' | 'desc'>;
}

/**
 * A page of a list by a cursor (ADR 0033): the business backend answers the whole list the caller may see, the BFF orders it by a
 * unique key and the cursor is the key of the last item handed out (opaque: base64url JSON). The next page starts after that key,
 * so an item that is added or removed meanwhile does not shift or repeat the others, unlike an offset.
 */
export function paginate<T>(
  items: readonly T[],
  ordering: Ordering<T>,
  query: { cursor?: unknown; limit?: unknown },
): Page<T> {
  const limit = pageSize(query.limit);
  const after = query.cursor === undefined ? null : decodeCursor(query.cursor);
  const sorted = [...items].sort((a, b) =>
    compareKeys(ordering.key(a), ordering.key(b), ordering.directions),
  );
  const rest =
    after === null
      ? sorted
      : sorted.filter((item) => compareKeys(ordering.key(item), after, ordering.directions) > 0);
  const page = rest.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page,
    next: rest.length > limit && last !== undefined ? encodeCursor(ordering.key(last)) : null,
  };
}

/** `limit`: a whole number from 1 to 200, the default when it is not given. */
export function pageSize(value: unknown): number {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  const number = typeof value === 'string' && /^\d{1,4}$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(number) || number < 1 || number > MAX_PAGE_SIZE) {
    throw new BadRequestException(`limit must be a whole number from 1 to ${MAX_PAGE_SIZE}.`);
  }
  return number;
}

export function encodeCursor(key: SortKey): string {
  return Buffer.from(JSON.stringify(key)).toString('base64url');
}

/** A cursor this API handed out, or `400`: a cursor is never made by the caller. */
export function decodeCursor(value: unknown): SortKey {
  const invalid = () => new BadRequestException('cursor is not a cursor of this list.');
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) throw invalid();
  let key: unknown;
  try {
    key = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  if (
    !Array.isArray(key) ||
    key.length === 0 ||
    !key.every((part) => typeof part === 'string' || typeof part === 'number')
  ) {
    throw invalid();
  }
  return key as SortKey;
}

function compareKeys(a: SortKey, b: SortKey, directions: Array<'asc' | 'desc'>): number {
  for (let index = 0; index < directions.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === right) continue;
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    // Mixed types (a forged cursor) compare as text, so the order stays total.
    const order =
      typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left) < String(right)
          ? -1
          : 1;
    return directions[index] === 'desc' ? -order : order;
  }
  return 0;
}

/** A point in time as a number, so `2026-10-31T10:00:00Z` and `2026-10-31T10:00:00.5+00:00` sort by time and not as text. */
export function timeKey(value: string): number {
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}
