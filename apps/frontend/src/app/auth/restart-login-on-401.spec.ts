import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { LAST_RESTART_KEY, RESTART_COOLDOWN_MS, restartLoginOn401 } from './restart-login-on-401';
import { SessionService } from './session.service';
import { FakeSession, provideFakeSession } from './testing';

describe('restartLoginOn401', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let session: FakeSession;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([restartLoginOn401])),
        provideHttpClientTesting(),
        provideFakeSession(),
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    session = TestBed.inject(SessionService) as unknown as FakeSession;
  });

  /** Sends a request and answers it; resolves with how it ended. */
  async function request(url: string, status: number): Promise<number> {
    const done = new Promise<number>((resolve) =>
      http.get(url).subscribe({ next: () => resolve(200), error: (e) => resolve(e.status) }),
    );
    backend.expectOne(url).flush(null, { status, statusText: String(status) });
    return done;
  }

  it('starts the login again when the API says 401, and passes the error on', async () => {
    const outcome = await request('/api/boards', 401);

    expect(outcome).toBe(401);
    expect(session.restartCalls).toBe(1);
  });

  it('does not start it a second time right after: it would loop if the server keeps refusing', async () => {
    await request('/api/boards', 401);
    await request('/api/boards', 401);

    expect(session.restartCalls).toBe(1);
  });

  it('starts it again once the cooldown has passed', async () => {
    await request('/api/boards', 401);
    sessionStorage.setItem(LAST_RESTART_KEY, String(Date.now() - RESTART_COOLDOWN_MS - 1000));

    await request('/api/boards', 401);

    expect(session.restartCalls).toBe(2);
  });

  it.each([403, 404, 500, 502])('leaves a %i alone', async (status) => {
    expect(await request('/api/boards', status)).toBe(status);
    expect(session.restartCalls).toBe(0);
  });

  it('leaves a 401 of anything but our API alone', async () => {
    await request('/auth-config.json', 401);
    await request('https://example.com/api/boards', 401);

    expect(session.restartCalls).toBe(0);
  });

  it('does nothing for a successful call', async () => {
    expect(await request('/api/boards', 200)).toBe(200);
    expect(session.restartCalls).toBe(0);
  });

  it('still restarts when the storage is blocked (the cooldown cannot be kept, the login matters more)', async () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('blocked');
    };
    try {
      await request('/api/boards', 401);
    } finally {
      Storage.prototype.getItem = original;
    }

    expect(session.restartCalls).toBe(1);
  });
});
