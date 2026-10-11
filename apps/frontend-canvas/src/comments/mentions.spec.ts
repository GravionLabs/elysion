import { describe, expect, it } from 'vitest';
import { activeMention, applyMention, suggestions } from './mentions';

const people = [
  { id: '1', name: 'Ann Lee' },
  { id: '2', name: 'Anton' },
  { id: '3', name: 'Bob Annis' },
];

describe('activeMention', () => {
  it('finds the @ the caret is in', () => {
    expect(activeMention('hello @An', 9)).toEqual({ start: 6, query: 'An' });
    expect(activeMention('@', 1)).toEqual({ start: 0, query: '' });
    expect(activeMention('@Ann L', 6)).toEqual({ start: 0, query: 'Ann L' });
  });

  it('ignores an address and an @ that is far behind the caret', () => {
    expect(activeMention('mail me@example.com', 19)).toBeNull();
    expect(activeMention('hi @Ann and a sentence that goes on for a while', 46)).toBeNull();
    expect(activeMention('hi @Ann\nnext', 12)).toBeNull();
  });
});

describe('suggestions', () => {
  it('puts names that start with the query first, then names that contain it', () => {
    expect(suggestions(people, 'an').map((p) => p.name)).toEqual(['Ann Lee', 'Anton', 'Bob Annis']);
    expect(suggestions(people, 'ann').map((p) => p.name)).toEqual(['Ann Lee', 'Bob Annis']);
  });

  it('lists everybody for an empty query, once each, up to the maximum', () => {
    expect(suggestions([...people, people[0]], '', 2)).toHaveLength(2);
    expect(suggestions([...people, people[0]], '')).toHaveLength(3);
  });
});

describe('applyMention', () => {
  it('replaces the typed query with the name and moves the caret behind it', () => {
    const mention = activeMention('see @An please', 7)!;
    expect(applyMention('see @An please', 7, mention, people[0])).toEqual({
      text: 'see @Ann Lee  please',
      caret: 13,
    });
  });
});
