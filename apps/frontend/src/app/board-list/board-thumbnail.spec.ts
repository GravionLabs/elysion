import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardThumbnail } from './board-thumbnail';

describe('BoardThumbnail', () => {
  let fixture: ComponentFixture<BoardThumbnail>;
  let http: HttpTestingController;
  let created: string[];
  let revoked: string[];
  const img = () => (fixture.nativeElement as HTMLElement).querySelector('img');

  beforeEach(async () => {
    created = [];
    revoked = [];
    vi.stubGlobal('URL', {
      createObjectURL: () => {
        created.push(`blob:${created.length + 1}`);
        return created.at(-1)!;
      },
      revokeObjectURL: (url: string) => revoked.push(url),
    });
    // No IntersectionObserver in the test browser: the component loads at once then.
    vi.stubGlobal('IntersectionObserver', undefined);
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(BoardThumbnail);
    fixture.componentRef.setInput('boardId', 'b1');
    fixture.componentRef.setInput('version', '2026-10-10T10:00:00Z');
    await fixture.whenStable();
  });

  afterEach(() => vi.unstubAllGlobals());

  const respond = async (version: string) => {
    http
      .expectOne((r) => r.url === '/api/boards/b1/thumbnail' && r.params.get('v') === version)
      .flush(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }));
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('fetches the picture with the version in the address and shows it from an object URL', async () => {
    expect(img()).toBeNull();

    await respond('2026-10-10T10:00:00Z');

    expect(img()?.getAttribute('src')).toBe('blob:1');
    expect(img()?.getAttribute('alt')).toBe('');
  });

  it('fetches a newer picture when the version changes and gives the old object URL back', async () => {
    await respond('2026-10-10T10:00:00Z');

    fixture.componentRef.setInput('version', '2026-10-10T11:00:00Z');
    await fixture.whenStable();
    await respond('2026-10-10T11:00:00Z');

    expect(img()?.getAttribute('src')).toBe('blob:2');
    expect(revoked).toEqual(['blob:1']);
  });

  it('shows nothing when the picture cannot be fetched', async () => {
    http
      .expectOne((r) => r.url === '/api/boards/b1/thumbnail')
      .flush(new Blob(['gone']), { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();

    expect(img()).toBeNull();
  });

  it('gives its object URL back when it is destroyed', async () => {
    await respond('2026-10-10T10:00:00Z');

    fixture.destroy();

    expect(revoked).toEqual(['blob:1']);
  });
});
