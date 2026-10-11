import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { GroupsApi } from './groups-api';

const room = '0197a8d2-1c3e-7a10-8000-0000000000b1';
const group = 'g/1';

describe('GroupsApi', () => {
  let api: GroupsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(GroupsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('searches groups by name', async () => {
    const result = firstValueFrom(api.search('des'));

    const request = http.expectOne((r) => r.url === '/api/groups');
    expect(request.request.params.get('query')).toBe('des');
    request.flush([{ id: 'g1', name: 'Design', source: 'Local' }]);
    expect(await result).toEqual([{ id: 'g1', name: 'Design', source: 'Local' }]);
  });

  it("lists, sets and removes a group's role in a room", async () => {
    const list = firstValueFrom(api.listForRoom(room));
    http.expectOne(`/api/rooms/${room}/groups`).flush([]);
    expect(await list).toEqual([]);

    const set = firstValueFrom(api.setRole(room, group, 'Editor'));
    const put = http.expectOne(`/api/rooms/${room}/groups/g%2F1`);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ role: 'Editor' });
    put.flush({ groupId: group, name: 'Design', role: 'Editor' });
    expect((await set).role).toBe('Editor');

    const removed = firstValueFrom(api.remove(room, group));
    const del = http.expectOne(`/api/rooms/${room}/groups/g%2F1`);
    expect(del.request.method).toBe('DELETE');
    del.flush(null);
    await removed;
  });
});
