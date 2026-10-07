import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { RoomApi, RoomInfo, canAdministerRoom, canWriteInRoom } from './room-api';

const id = '0197a8d2-1c3e-7a10-8000-0000000000b1';
const room: RoomInfo = { id, name: 'Sprint', createdAt: '2026-10-05T00:00:00Z', role: 'Owner' };

describe('RoomApi', () => {
  let api: RoomApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(RoomApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists the rooms with GET /api/rooms', async () => {
    const result = firstValueFrom(api.list());

    const request = http.expectOne('/api/rooms');
    expect(request.request.method).toBe('GET');
    request.flush([room]);

    expect(await result).toEqual([room]);
  });

  it('creates a room with the name in the body', async () => {
    const result = firstValueFrom(api.create('Sprint'));

    const request = http.expectOne('/api/rooms');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ name: 'Sprint' });
    request.flush(room);

    expect(await result).toEqual(room);
  });

  it('renames a room', async () => {
    const result = firstValueFrom(api.rename(id, 'New'));

    const request = http.expectOne(`/api/rooms/${id}`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ name: 'New' });
    request.flush({ ...room, name: 'New' });

    expect((await result).name).toBe('New');
  });

  it('deletes a room', async () => {
    const result = firstValueFrom(api.delete(id));

    const request = http.expectOne(`/api/rooms/${id}`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });

    await expect(result).resolves.toBeNull();
  });

  it('does not hide a failing call', async () => {
    const result = firstValueFrom(api.rename(id, 'x'));

    http.expectOne(`/api/rooms/${id}`).flush('', { status: 403, statusText: 'Forbidden' });

    await expect(result).rejects.toMatchObject({ status: 403 });
  });

  it('knows what each role may do', () => {
    expect([
      canWriteInRoom({ ...room, role: 'Owner' }),
      canAdministerRoom({ ...room, role: 'Owner' }),
    ]).toEqual([true, true]);
    expect([
      canWriteInRoom({ ...room, role: 'Editor' }),
      canAdministerRoom({ ...room, role: 'Editor' }),
    ]).toEqual([true, false]);
    expect([
      canWriteInRoom({ ...room, role: 'Viewer' }),
      canAdministerRoom({ ...room, role: 'Viewer' }),
    ]).toEqual([false, false]);
  });
});
