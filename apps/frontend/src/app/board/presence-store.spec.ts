import { TestBed } from '@angular/core/testing';
import { PresenceStore } from './presence-store';

describe('PresenceStore', () => {
  let store: PresenceStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [PresenceStore] });
    store = TestBed.inject(PresenceStore);
  });

  const ada = { id: 'a', name: 'Ada', color: '#14b8a6' };
  const bea = { id: 'b', name: 'Bea', color: '#3b82f6' };

  it('starts empty', () => {
    expect(store.users()).toEqual([]);
    expect(store.count()).toBe(0);
  });

  it('holds the users of a presence event and counts them', () => {
    store.setFromEvent({ users: [ada, bea] });

    expect(store.users()).toEqual([ada, bea]);
    expect(store.count()).toBe(2);
  });

  it('replaces the list with each event, also with an empty one', () => {
    store.setFromEvent({ users: [ada, bea] });
    store.setFromEvent({ users: [bea] });
    expect(store.users()).toEqual([bea]);

    store.setFromEvent({ users: [] });
    expect(store.users()).toEqual([]);
  });

  it('drops entries that are not an id, a name and a hex color, and ignores a malformed event', () => {
    store.setFromEvent({
      users: [
        ada,
        null,
        'x',
        { id: 'c', name: 'C', color: 'red' },
        { id: 'd', color: '#14b8a6' },
        { id: 1, name: 'E', color: '#14b8a6' },
      ],
    });
    expect(store.users()).toEqual([ada]);

    for (const detail of [undefined, null, {}, { users: 'Ada' }, 42]) {
      store.setFromEvent(detail);
      expect(store.users()).toEqual([]);
    }
  });

  it('is emptied by clear()', () => {
    store.setFromEvent({ users: [ada] });

    store.clear();

    expect(store.users()).toEqual([]);
  });
});
