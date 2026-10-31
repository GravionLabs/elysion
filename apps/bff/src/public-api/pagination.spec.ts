import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { type Ordering, decodeCursor, encodeCursor, paginate, timeKey } from './pagination.js';

interface Item {
  id: string;
  createdAt: string;
}

const newestFirst: Ordering<Item> = {
  key: (item) => [timeKey(item.createdAt), item.id],
  directions: ['desc', 'asc'],
};

const items: Item[] = [
  { id: 'a', createdAt: '2026-10-01T10:00:00Z' },
  { id: 'b', createdAt: '2026-10-03T10:00:00.5+00:00' },
  { id: 'c', createdAt: '2026-10-02T10:00:00Z' },
  { id: 'd', createdAt: '2026-10-02T10:00:00Z' },
];

describe('paginate', () => {
  it('orders by the key and walks the list page by page with the cursor', () => {
    const first = paginate(items, newestFirst, { limit: '2' });
    const second = paginate(items, newestFirst, { limit: '2', cursor: first.next });

    expect(first.items.map((item) => item.id)).toEqual(['b', 'c']);
    expect(first.next).not.toBeNull();
    expect(second.items.map((item) => item.id)).toEqual(['d', 'a']);
    expect(second.next).toBeNull();
  });

  it('answers 50 items by default and no cursor when everything fits', () => {
    const many = Array.from({ length: 51 }, (_, index) => ({
      id: `id-${String(index).padStart(2, '0')}`,
      createdAt: '2026-10-01T00:00:00Z',
    }));

    expect(paginate(many, newestFirst, {}).items).toHaveLength(50);
    expect(paginate(items, newestFirst, {}).next).toBeNull();
  });

  it('answers an empty page for an empty list', () => {
    expect(paginate([], newestFirst, {})).toEqual({ items: [], next: null });
  });

  it('neither repeats nor skips an item when one before the cursor is removed meanwhile', () => {
    const first = paginate(items, newestFirst, { limit: '2' });
    const withoutB = items.filter((item) => item.id !== 'b');

    const second = paginate(withoutB, newestFirst, { limit: '2', cursor: first.next });

    expect(second.items.map((item) => item.id)).toEqual(['d', 'a']);
  });

  it('refuses a limit outside 1 to 200 or that is no whole number (400)', () => {
    for (const limit of ['0', '201', '-1', '2.5', 'ten', '', ['1', '2']]) {
      expect(() => paginate(items, newestFirst, { limit })).toThrow(BadRequestException);
    }
    expect(paginate(items, newestFirst, { limit: '200' }).items).toHaveLength(4);
  });

  it('refuses a cursor it did not make (400)', () => {
    for (const cursor of [
      '',
      'not base64 json!',
      Buffer.from('{"a":1}').toString('base64url'),
      Buffer.from('[]').toString('base64url'),
      Buffer.from('[null]').toString('base64url'),
      'x'.repeat(600),
      ['a', 'b'],
    ]) {
      expect(() => paginate(items, newestFirst, { cursor })).toThrow(BadRequestException);
    }
  });
});

describe('the cursor', () => {
  it('is the key, opaque and safe in a URL', () => {
    const cursor = encodeCursor([1_700_000_000_000, 'a/b+c']);

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor)).toEqual([1_700_000_000_000, 'a/b+c']);
  });
});
