import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import type { CanvasElement } from './canvas-element';
import { MIN_THUMBNAIL_INTERVAL_MS, ThumbnailUploader } from './thumbnail-uploader';

describe('ThumbnailUploader', () => {
  const setup = () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    return {
      uploader: TestBed.inject(ThumbnailUploader),
      http: TestBed.inject(HttpTestingController),
    };
  };
  const picture = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
  const canvasWith = (exportThumbnail: () => Promise<Blob | null>) =>
    ({ exportThumbnail }) as unknown as CanvasElement;
  const settle = () => new Promise((resolve) => setTimeout(resolve));

  it('renders the board and stores the picture as a PNG', async () => {
    const { uploader, http } = setup();

    const saving = uploader.save(
      'b1',
      canvasWith(async () => picture),
    );
    await settle();
    const request = http.expectOne('/api/boards/b1/thumbnail');
    expect(request.request.method).toBe('PUT');
    expect(request.request.headers.get('Content-Type')).toBe('image/png');
    expect(request.request.body).toBe(picture);
    request.flush(null);

    expect(await saving).toBe(true);
  });

  it('makes no second picture of a board within half a minute, and one again after that', async () => {
    const { uploader, http } = setup();
    const render = vi.fn(async () => picture);
    const canvas = canvasWith(render);
    const first = uploader.save('b1', canvas, 1_000);
    await settle();
    http.expectOne('/api/boards/b1/thumbnail').flush(null);
    await first;

    expect(await uploader.save('b1', canvas, 1_000 + MIN_THUMBNAIL_INTERVAL_MS - 1)).toBe(false);
    expect(render).toHaveBeenCalledTimes(1);

    const later = uploader.save('b1', canvas, 1_000 + MIN_THUMBNAIL_INTERVAL_MS);
    await settle();
    http.expectOne('/api/boards/b1/thumbnail').flush(null);
    expect(await later).toBe(true);
  });

  it('keeps the boards apart', async () => {
    const { uploader, http } = setup();
    const canvas = canvasWith(async () => picture);
    const a = uploader.save('a', canvas, 1_000);
    const b = uploader.save('b', canvas, 1_001);
    await settle();

    http.expectOne('/api/boards/a/thumbnail').flush(null);
    http.expectOne('/api/boards/b/thumbnail').flush(null);

    expect(await Promise.all([a, b])).toEqual([true, true]);
  });

  it('says when the picture is drawn, apart from when it is stored: the router waits only for the first', async () => {
    const { uploader, http } = setup();
    const started = uploader.start(
      'b1',
      canvasWith(async () => picture),
      1_000,
    )!;

    await started.rendered;
    // Drawn, not yet stored: the upload is under way, the person may already leave.
    const request = http.expectOne('/api/boards/b1/thumbnail');
    request.flush(null);

    expect(await started.done).toBe(true);
  });

  it('does not start when a picture is not due', async () => {
    const { uploader } = setup();
    const canvas = canvasWith(async () => null);

    expect(uploader.start('b1', undefined)).toBeNull();
    uploader.start(
      'b1',
      canvasWith(async () => picture),
      1_000,
    );
    expect(uploader.start('b1', canvas, 1_100)).toBeNull();
  });

  it('stores nothing for an empty board, and may try again soon', async () => {
    const { uploader, http } = setup();

    expect(
      await uploader.save(
        'b1',
        canvasWith(async () => null),
        1_000,
      ),
    ).toBe(false);

    http.expectNone('/api/boards/b1/thumbnail');
    expect(uploader.recently('b1', 1_001)).toBe(false);
  });

  it('does nothing without a canvas that can make the picture', async () => {
    const { uploader, http } = setup();

    expect(await uploader.save('b1', undefined)).toBe(false);
    expect(await uploader.save('b1', {} as CanvasElement)).toBe(false);

    http.verify();
  });

  it('says nothing when the upload fails, and lets the next leave try again', async () => {
    const { uploader, http } = setup();
    const saving = uploader.save(
      'b1',
      canvasWith(async () => picture),
      1_000,
    );
    await settle();

    http
      .expectOne('/api/boards/b1/thumbnail')
      .flush('no', { status: 500, statusText: 'Server Error' });

    expect(await saving).toBe(false);
    expect(uploader.recently('b1', 1_001)).toBe(false);
  });
});
