import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { InvitationsApi, inviteUrl } from './invitations-api';

describe('InvitationsApi', () => {
  let api: InvitationsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(InvitationsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists, creates and revokes the links of a board', () => {
    api.list('b1', 'board').subscribe();
    http.expectOne('/api/boards/b1/invitations').flush([]);

    api.create('b1', 'board', { role: 'Viewer', expiresInHours: 24, maxUses: 3 }).subscribe();
    const create = http.expectOne('/api/boards/b1/invitations');
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual({ role: 'Viewer', expiresInHours: 24, maxUses: 3 });
    create.flush({});

    api.revoke('b1', 'board', 'i 1').subscribe();
    const revoke = http.expectOne('/api/boards/b1/invitations/i%201');
    expect(revoke.request.method).toBe('DELETE');
    revoke.flush(null);
  });

  it('uses the room routes for a room', () => {
    api.list('r1', 'room').subscribe();
    http.expectOne('/api/rooms/r1/invitations').flush([]);
  });

  it('accepts a link with the token in the path, without a body', () => {
    api.accept('a/b').subscribe();
    const request = http.expectOne('/api/invitations/a%2Fb/accept');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toBeNull();
    request.flush({ kind: 'board', id: 'b1', role: 'Viewer' });
  });

  it('builds the address from the origin and the token', () => {
    expect(inviteUrl('https://elysion.test', 'abc-_')).toBe('https://elysion.test/invite/abc-_');
  });
});
