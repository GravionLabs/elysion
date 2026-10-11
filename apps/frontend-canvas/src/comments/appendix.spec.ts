import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { en, de } from '../i18n';
import { buildAppendix } from './appendix';
import { addReply, addThread, readThreads, setResolved } from './comments';

const ann = { id: 'u-ann', name: 'Ann' };
const bob = { id: 'u-bob', name: 'Bob' };

describe('buildAppendix', () => {
  it('is nothing for a board without comments', () => {
    expect(buildAppendix([], new Map(), en, 'en', () => null)).toBeNull();
  });

  it('lists the open threads first, then the resolved ones, with the mentions as names', () => {
    const doc = new Y.Doc();
    const first = addThread(doc, { elementId: 'e1' }, 'Why? @{u-bob}', ann, 1);
    addThread(doc, { x: 1, y: 2 }, 'Here', ann, 2);
    addReply(doc, first, 'Because', bob, 3);
    setResolved(doc, first, true, bob);

    const appendix = buildAppendix(
      readThreads(doc),
      new Map([['u-bob', 'Bob']]),
      en,
      'en',
      (anchor) => ('elementId' in anchor ? 'Sticky' : null),
    )!;

    expect(appendix.title).toBe('Comments');
    expect(appendix.sections.map((section) => section.heading)).toEqual(['Open', 'Resolved']);
    expect(appendix.sections[0].threads[0].where).toBe('On a point of the board');
    const resolved = appendix.sections[1].threads[0];
    expect(resolved.where).toBe('On Sticky');
    expect(resolved.resolvedBy).toBe('Resolved by Bob');
    expect(resolved.messages.map((message) => message.text)).toEqual(['Why? @Bob', 'Because']);
  });

  it('speaks the language of the canvas and says when the element is gone', () => {
    const doc = new Y.Doc();
    addThread(doc, { elementId: 'gone' }, 'Hm', ann, 1);

    const appendix = buildAppendix(readThreads(doc), new Map(), de, 'de', () => null)!;

    expect(appendix.title).toBe('Kommentare');
    expect(appendix.sections[0].threads[0].where).toBe('Das Element gibt es nicht mehr');
  });
});
