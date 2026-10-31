import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SnapshotApi } from './snapshot-api';

describe('SnapshotApi', () => {
  let http: HttpTestingController;
  let board = '';
  let api: ReturnType<SnapshotApi['forBoard']>;

  beforeEach(() => {
    board = 'b/1';
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(SnapshotApi).forBoard(() => board);
  });

  afterEach(() => http.verify());

  it('lists the versions of the board of the page', async () => {
    board = 'b2';
    const listed = api.list();
    const request = http.expectOne('/api/boards/b2/snapshots');
    expect(request.request.method).toBe('GET');
    request.flush([{ id: 's1' }]);

    expect(await listed).toEqual([{ id: 's1' }]);
  });

  it('saves a version with a name, and without one with an empty body', async () => {
    const named = api.create('Before');
    const first = http.expectOne('/api/boards/b%2F1/snapshots');
    expect(first.request.method).toBe('POST');
    expect(first.request.body).toEqual({ name: 'Before' });
    first.flush({ id: 's1' });
    await named;

    const unnamed = api.create();
    const second = http.expectOne('/api/boards/b%2F1/snapshots');
    expect(second.request.body).toEqual({});
    second.flush({ id: 's2' });
    await unnamed;
  });

  it('renames and deletes with the version in the path', async () => {
    const renamed = api.rename('s 1', 'New');
    const patch = http.expectOne('/api/boards/b%2F1/snapshots/s%201');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ name: 'New' });
    patch.flush({ id: 's 1', name: 'New' });
    await renamed;

    const removed = api.remove('s 1');
    const remove = http.expectOne('/api/boards/b%2F1/snapshots/s%201');
    expect(remove.request.method).toBe('DELETE');
    remove.flush(null, { status: 204, statusText: 'No Content' });
    await removed;
  });

  it('reads the state of a version as bytes', async () => {
    const state = api.document('s1');
    const request = http.expectOne('/api/boards/b%2F1/snapshots/s1/document');
    expect(request.request.responseType).toBe('arraybuffer');
    request.flush(new Uint8Array([1, 2, 3]).buffer);

    expect(await state).toEqual(new Uint8Array([1, 2, 3]));
  });

  it.each([403, 409, 503])(
    'rejects with the HTTP status %i for the canvas to explain',
    async (status) => {
      const saved = api.create('x');
      http.expectOne('/api/boards/b%2F1/snapshots').flush(null, { status, statusText: 'Refused' });

      await expect(saved).rejects.toMatchObject({ status });
    },
  );

  it('rejects with status 0 when the request itself failed', async () => {
    const listed = api.list();
    http.expectOne('/api/boards/b%2F1/snapshots').error(new ProgressEvent('error'));

    await expect(listed).rejects.toHaveProperty('status', 0);
  });
});
