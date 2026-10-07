import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { BoardApi, BoardInfo } from './board-api';

const id = '0197a8d2-1c3e-7a10-8000-000000000001';
const board: BoardInfo = {
  id,
  name: 'Retro',
  createdAt: '2026-10-05T00:00:00Z',
  roomId: null,
  path: `/board/${id}`,
};

describe('BoardApi', () => {
  let api: BoardApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(BoardApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads a board from the BFF', async () => {
    const result = firstValueFrom(api.get(id));

    http.expectOne(`/api/boards/${id}`).flush(board);

    expect(await result).toEqual(board);
  });

  it('answers null for an unknown board', async () => {
    const result = firstValueFrom(api.get(id));

    http.expectOne(`/api/boards/${id}`).flush('', { status: 404, statusText: 'Not Found' });

    expect(await result).toBeNull();
  });

  it('answers null when the BFF fails', async () => {
    const result = firstValueFrom(api.get(id));

    http.expectOne(`/api/boards/${id}`).flush('', { status: 502, statusText: 'Bad Gateway' });

    expect(await result).toBeNull();
  });

  it('does not ask for an id that cannot be a board id', async () => {
    expect(await firstValueFrom(api.get('default'))).toBeNull();
    expect(await firstValueFrom(api.get('q3 plan/v2'))).toBeNull();

    http.expectNone(() => true);
  });

  it('lists the boards', async () => {
    const result = firstValueFrom(api.list());

    http.expectOne('/api/boards').flush([board]);

    expect(await result).toEqual([board]);
  });

  it('does not hide a failing list: the page shows its error state', async () => {
    const result = firstValueFrom(api.list());

    http.expectOne('/api/boards').flush('', { status: 502, statusText: 'Bad Gateway' });

    await expect(result).rejects.toMatchObject({ status: 502 });
  });

  it('creates a board with the given name', async () => {
    const result = firstValueFrom(api.create('Retro'));

    const request = http.expectOne('/api/boards');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ name: 'Retro' });
    request.flush(board);

    expect(await result).toEqual(board);
  });

  it('does not hide a failing create', async () => {
    const result = firstValueFrom(api.create('Retro'));

    http.expectOne('/api/boards').flush('', { status: 400, statusText: 'Bad Request' });

    await expect(result).rejects.toMatchObject({ status: 400 });
  });

  it('renames a board with a PATCH', async () => {
    const result = firstValueFrom(api.rename(id, 'Planning'));

    const request = http.expectOne(`/api/boards/${id}`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ name: 'Planning' });
    request.flush({ ...board, name: 'Planning' });

    expect((await result).name).toBe('Planning');
  });

  it('does not hide a failing rename', async () => {
    const result = firstValueFrom(api.rename(id, 'Planning'));

    http.expectOne(`/api/boards/${id}`).flush('', { status: 404, statusText: 'Not Found' });

    await expect(result).rejects.toMatchObject({ status: 404 });
  });

  describe('myRole', () => {
    it("asks the BFF for the user's role on a stored board", async () => {
      const result = firstValueFrom(api.myRole(id));

      const request = http.expectOne(`/api/boards/${id}/membership/me`);
      expect(request.request.method).toBe('GET');
      request.flush({ boardId: id, role: 'viewer' });

      expect(await result).toBe('viewer');
    });

    it("is null without a role (404), when the BFF fails, and for an id that is no stored board's", async () => {
      const none = firstValueFrom(api.myRole(id));
      http
        .expectOne(`/api/boards/${id}/membership/me`)
        .flush(null, { status: 404, statusText: 'Not Found' });
      expect(await none).toBeNull();

      const failing = firstValueFrom(api.myRole(id));
      http
        .expectOne(`/api/boards/${id}/membership/me`)
        .flush(null, { status: 502, statusText: 'Bad Gateway' });
      expect(await failing).toBeNull();

      expect(await firstValueFrom(api.myRole('default'))).toBeNull();
      http.expectNone('/api/boards/default/membership/me');
    });
  });

  describe('realtimeToken', () => {
    it('asks the BFF for a token for the board', async () => {
      const result = firstValueFrom(api.realtimeToken(id));

      const request = http.expectOne('/api/realtime/token');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ boardId: id });
      request.flush({ token: 'abc', expiresAt: '2026-10-05T12:01:00Z' });

      expect(await result).toEqual({ token: 'abc', expiresAt: '2026-10-05T12:01:00Z' });
    });

    it('does not hide a refusal: a 403 means no role on the board', async () => {
      const result = firstValueFrom(api.realtimeToken(id)).catch((e: unknown) => e);

      http.expectOne('/api/realtime/token').flush(null, { status: 403, statusText: 'Forbidden' });

      expect(await result).toMatchObject({ status: 403 });
    });
  });

  describe('find', () => {
    it('is a room, without a request, for an id that cannot be a stored board', async () => {
      expect(await firstValueFrom(api.find('default'))).toEqual({ status: 'room' });
      http.expectNone(() => true);
    });

    it('finds a stored board', async () => {
      const result = firstValueFrom(api.find(id));

      http.expectOne(`/api/boards/${id}`).flush(board);

      expect(await result).toEqual({ status: 'found', board });
    });

    it('says a board is missing on a 404', async () => {
      const result = firstValueFrom(api.find(id));

      http.expectOne(`/api/boards/${id}`).flush('', { status: 404, statusText: 'Not Found' });

      expect(await result).toEqual({ status: 'missing' });
    });

    it('says it is unavailable, not missing, when the BFF fails', async () => {
      const result = firstValueFrom(api.find(id));

      http.expectOne(`/api/boards/${id}`).flush('', { status: 502, statusText: 'Bad Gateway' });

      expect(await result).toEqual({ status: 'unavailable' });
    });
  });

  it('duplicates a board with a POST', async () => {
    const result = firstValueFrom(api.duplicate(id));

    const request = http.expectOne(`/api/boards/${id}/duplicate`);
    expect(request.request.method).toBe('POST');
    request.flush({ ...board, name: 'Retro (copy)' });

    expect((await result).name).toBe('Retro (copy)');
  });

  it('does not hide a failing duplicate', async () => {
    const result = firstValueFrom(api.duplicate(id));

    http
      .expectOne(`/api/boards/${id}/duplicate`)
      .flush('', { status: 404, statusText: 'Not Found' });

    await expect(result).rejects.toMatchObject({ status: 404 });
  });

  it('deletes a board', async () => {
    const result = firstValueFrom(api.delete(id));

    const request = http.expectOne(`/api/boards/${id}`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });

    await expect(result).resolves.toBeNull();
  });

  it('does not hide a failing delete', async () => {
    const result = firstValueFrom(api.delete(id));

    http.expectOne(`/api/boards/${id}`).flush('', { status: 404, statusText: 'Not Found' });

    await expect(result).rejects.toMatchObject({ status: 404 });
  });

  describe('moving a board to a room', () => {
    const room = '0197a8d2-1c3e-7a10-8000-0000000000b1';

    it('puts the board in a room with PUT /api/boards/:id/room', async () => {
      const result = firstValueFrom(api.moveToRoom(id, room));

      const request = http.expectOne(`/api/boards/${id}/room`);
      expect(request.request.method).toBe('PUT');
      expect(request.request.body).toEqual({ roomId: room });
      request.flush({ ...board, roomId: room });

      expect((await result).roomId).toBe(room);
    });

    it('takes it out of its room with a null room', async () => {
      const result = firstValueFrom(api.moveToRoom(id, null));

      const request = http.expectOne(`/api/boards/${id}/room`);
      expect(request.request.body).toEqual({ roomId: null });
      request.flush(board);

      expect((await result).roomId).toBeNull();
    });

    it('does not hide a refusal', async () => {
      const result = firstValueFrom(api.moveToRoom(id, room));

      http.expectOne(`/api/boards/${id}/room`).flush('', { status: 403, statusText: 'Forbidden' });

      await expect(result).rejects.toMatchObject({ status: 403 });
    });
  });
});
