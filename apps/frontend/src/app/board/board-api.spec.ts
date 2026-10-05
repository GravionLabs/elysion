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
});
