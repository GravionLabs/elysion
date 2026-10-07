import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { MembersApi } from './members-api';

const board = '0197a8d2-1c3e-7a10-8000-000000000001';
const user = '0197a8d2-1c3e-7a10-8000-0000000000aa';
const member = {
  userId: user,
  displayName: 'Ada',
  email: 'ada@example.com',
  role: 'Editor' as const,
};

describe('MembersApi', () => {
  let api: MembersApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(MembersApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists the members of a board', async () => {
    const result = firstValueFrom(api.list(board));

    const request = http.expectOne(`/api/boards/${board}/members`);
    expect(request.request.method).toBe('GET');
    request.flush([member]);

    expect(await result).toEqual([member]);
  });

  it('adds a member by email and role', async () => {
    const result = firstValueFrom(api.add(board, 'ada@example.com', 'Editor'));

    const request = http.expectOne(`/api/boards/${board}/members`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ email: 'ada@example.com', role: 'Editor' });
    request.flush(member);

    expect(await result).toEqual(member);
  });

  it('changes a role', async () => {
    const result = firstValueFrom(api.changeRole(board, user, 'Viewer'));

    const request = http.expectOne(`/api/boards/${board}/members/${user}`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ role: 'Viewer' });
    request.flush({ ...member, role: 'Viewer' });

    expect((await result).role).toBe('Viewer');
  });

  it('removes a member', async () => {
    const result = firstValueFrom(api.remove(board, user), { defaultValue: undefined });

    const request = http.expectOne(`/api/boards/${board}/members/${user}`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });

    await result;
  });

  it('encodes ids in the URL', () => {
    api.list('a b/c').subscribe();

    http.expectOne('/api/boards/a%20b%2Fc/members').flush([]);
  });

  it('does not hide a refusal: the dialog shows the message of the API', async () => {
    const result = firstValueFrom(api.add(board, 'x@y.z', 'Viewer')).catch((e: unknown) => e);

    http
      .expectOne(`/api/boards/${board}/members`)
      .flush({ message: 'No user with this email' }, { status: 404, statusText: 'Not Found' });

    expect(await result).toMatchObject({
      status: 404,
      error: { message: 'No user with this email' },
    });
  });

  describe('for a room', () => {
    const room = '0197a8d2-1c3e-7a10-8000-0000000000b1';

    it('talks to /api/rooms/:id/members for every call', async () => {
      const list = firstValueFrom(api.list(room, 'room'));
      http.expectOne(`/api/rooms/${room}/members`).flush([member]);
      expect(await list).toEqual([member]);

      const add = firstValueFrom(api.add(room, 'ada@example.com', 'Viewer', 'room'));
      const added = http.expectOne(`/api/rooms/${room}/members`);
      expect(added.request.method).toBe('POST');
      expect(added.request.body).toEqual({ email: 'ada@example.com', role: 'Viewer' });
      added.flush(member);
      await add;

      const change = firstValueFrom(api.changeRole(room, user, 'Editor', 'room'));
      const changed = http.expectOne(`/api/rooms/${room}/members/${user}`);
      expect(changed.request.method).toBe('PATCH');
      changed.flush(member);
      await change;
    });

    it('removes a member of a room', async () => {
      const result = firstValueFrom(api.remove(room, user, 'room'));

      const request = http.expectOne(`/api/rooms/${room}/members/${user}`);
      expect(request.request.method).toBe('DELETE');
      request.flush(null, { status: 204, statusText: 'No Content' });

      await expect(result).resolves.toBeNull();
    });
  });
});
