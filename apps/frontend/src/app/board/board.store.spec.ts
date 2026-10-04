import { TestBed } from '@angular/core/testing';
import { BoardStore } from './board.store';

describe('BoardStore', () => {
  const store = () =>
    TestBed.configureTestingModule({ providers: [BoardStore] }).inject(BoardStore);

  it('starts loading and moves to ready or error', () => {
    const s = store();
    expect(s.status()).toBe('loading');
    expect(s.isReady()).toBe(false);
    s.markReady();
    expect(s.isReady()).toBe(true);
    s.markError();
    expect(s.status()).toBe('error');
  });

  it('tracks collaborators by client id without duplicates', () => {
    const s = store();
    s.collaboratorJoined({ clientId: 1, name: 'Ada', color: '#f00' });
    s.collaboratorJoined({ clientId: 2, name: 'Linus', color: '#0f0' });
    s.collaboratorJoined({ clientId: 1, name: 'Ada L.', color: '#f00' });
    expect(s.collaboratorCount()).toBe(2);
    expect(s.collaborators().find((c) => c.clientId === 1)?.name).toBe('Ada L.');

    s.collaboratorLeft(2);
    expect(s.collaborators().map((c) => c.clientId)).toEqual([1]);
  });
});
