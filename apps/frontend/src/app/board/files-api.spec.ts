import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { FilesApi } from './files-api';

const board = '0197a8d2-1c3e-7a10-8000-000000000001';
const fileId = 'abcdef0123456789abcdef0123456789abcdef01';

describe('FilesApi', () => {
  let http: HttpTestingController;
  let boardId: string;
  let store: ReturnType<FilesApi['storeFor']>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    boardId = board;
    store = TestBed.inject(FilesApi).storeFor(() => boardId);
  });

  afterEach(() => http.verify());

  it('uploads a file with its own type as the body of a PUT', async () => {
    const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
    const done = store.put(png, fileId);

    const request = http.expectOne(`/api/boards/${board}/files/${fileId}`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.headers.get('Content-Type')).toBe('image/png');
    expect(request.request.body).toBe(png);
    request.flush(null, { status: 204, statusText: 'No Content' });

    await expect(done).resolves.toBeUndefined();
  });

  it('follows the board of the page', async () => {
    boardId = '0197a8d2-1c3e-7a10-8000-000000000002';
    const done = store.get(fileId);

    http.expectOne(`/api/boards/${boardId}/files/${fileId}`).flush(new Blob(['x']));

    await done;
  });

  it('loads a file as a blob', async () => {
    const done = store.get(fileId);

    const request = http.expectOne(`/api/boards/${board}/files/${fileId}`);
    expect(request.request.method).toBe('GET');
    expect(request.request.responseType).toBe('blob');
    request.flush(new Blob(['bytes'], { type: 'image/png' }));

    expect((await done).type).toBe('image/png');
  });

  it.each([
    [400, 'Only PNG, JPEG, GIF and WebP images can be added.'],
    [415, 'Only PNG, JPEG, GIF and WebP images can be added.'],
    [403, 'You can only look at this board, not add images.'],
    [409, 'This board holds as many images as it can. Delete some to add more.'],
    [413, 'The image is too large.'],
    [502, 'The image could not be saved.'],
  ])('says in words why an upload with status %i was refused', async (status, message) => {
    const done = store.put(new Blob(['x'], { type: 'image/png' }), fileId);

    http.expectOne(`/api/boards/${board}/files/${fileId}`).flush('', { status, statusText: 'x' });

    await expect(done).rejects.toThrow(message);
  });
});
