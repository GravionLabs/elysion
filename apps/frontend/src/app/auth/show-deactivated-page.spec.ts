import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { showDeactivatedPage } from './show-deactivated-page';

describe('showDeactivatedPage', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([showDeactivatedPage])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  async function answer(url: string, status: number, body: object | null): Promise<number> {
    const done = new Promise<number>((resolve) =>
      http.get(url).subscribe({ next: () => resolve(200), error: (e) => resolve(e.status) }),
    );
    backend.expectOne(url).flush(body, { status, statusText: String(status) });
    return done;
  }

  it('takes a person whose account was deactivated to the page that says so, and passes the error on', async () => {
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const outcome = await answer('/api/boards', 403, { code: 'account-deactivated' });

    expect(outcome).toBe(403);
    expect(navigate).toHaveBeenCalledWith('/deactivated', { replaceUrl: true });
  });

  it('does not navigate again from that page', async () => {
    vi.spyOn(router, 'url', 'get').mockReturnValue('/deactivated');
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    await answer('/api/rooms', 403, { code: 'account-deactivated' });

    expect(navigate).not.toHaveBeenCalled();
  });

  it.each([
    ['another 403', '/api/boards', 403, { message: 'Forbidden' }],
    ['a 403 without a body', '/api/boards', 403, null],
    ['the code on another status', '/api/boards', 500, { code: 'account-deactivated' }],
    ['a call that is not ours', '/elsewhere', 403, { code: 'account-deactivated' }],
  ])('leaves %s alone', async (_name, url, status, body) => {
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    await answer(url, status, body);

    expect(navigate).not.toHaveBeenCalled();
  });
});
