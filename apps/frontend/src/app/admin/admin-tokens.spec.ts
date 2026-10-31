import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { AdminAccessToken, Page } from './admin-api';
import { AdminTokens } from './admin-tokens';

const token = (n: number, extra: Partial<AdminAccessToken> = {}): AdminAccessToken => ({
  id: `t${n}`,
  name: `Token ${n}`,
  prefix: `elp_abcd000${n}`,
  scopes: ['boards:read'],
  owner: { id: `u${n}`, displayName: `Owner ${n}` },
  createdAt: '2026-10-01T10:00:00Z',
  lastUsedAt: null,
  expiresAt: '2099-01-01T00:00:00Z',
  revokedAt: null,
  ...extra,
});

const page = (items: AdminAccessToken[], total = items.length): Page<AdminAccessToken> => ({
  items,
  total,
  page: 1,
  pageSize: 25,
});

describe('AdminTokens', () => {
  let fixture: ComponentFixture<AdminTokens>;
  let http: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;
  const rows = () => [...el().querySelectorAll('tbody tr')];
  const settle = () => fixture.whenStable();
  const listRequest = (query = '') =>
    http.expectOne(
      (r) =>
        r.url === '/api/admin/access-tokens' &&
        r.params.get('page') === '1' &&
        r.params.get('query') === (query || null),
    );
  const confirm = () =>
    (
      [...el().querySelectorAll('[role="dialog"] button')].find(
        (b) => b.textContent?.trim() === 'Revoke',
      ) as HTMLButtonElement
    ).click();

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminTokens],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AdminTokens);
    await settle();
  });

  afterEach(() => http.verify());

  it('lists every token with its owner, start and state, and offers no revoke for a revoked one', async () => {
    listRequest().flush(
      page([
        token(1),
        token(2, { revokedAt: '2026-10-10T00:00:00Z' }),
        token(3, { expiresAt: '2020-01-01T00:00:00Z' }),
      ]),
    );
    await settle();

    expect(rows().length).toBe(3);
    expect(rows()[0].textContent).toContain('Owner 1');
    expect(rows()[0].textContent).toContain('elp_abcd0001…');
    expect(rows()[1].querySelector('th')?.textContent).toContain('revoked');
    expect(rows()[1].querySelector('button')).toBeNull();
    expect(rows()[2].querySelector('th')?.textContent).toContain('expired');
  });

  it('searches with the text', async () => {
    listRequest().flush(page([token(1)]));
    await settle();

    const input = el().querySelector('input[type="search"]') as HTMLInputElement;
    input.value = 'elp_abcd';
    input.dispatchEvent(new Event('input'));
    el().querySelector('form')!.dispatchEvent(new Event('submit'));

    listRequest('elp_abcd').flush(page([]));
    await settle();
    expect(el().textContent).toContain('No token matches');
  });

  it('revokes a token after asking and marks it revoked', async () => {
    listRequest().flush(page([token(1)]));
    await settle();

    (
      el().querySelector('button[aria-label="Revoke Token 1 of Owner 1"]') as HTMLButtonElement
    ).click();
    await settle();
    expect(el().querySelector('[role="dialog"]')?.textContent).toContain('Owner 1');
    confirm();

    http
      .expectOne((r) => r.method === 'DELETE' && r.url === '/api/admin/access-tokens/t1')
      .flush(null);
    await settle();

    expect(el().querySelector('[role="dialog"]')).toBeNull();
    expect(rows()[0].querySelector('th')?.textContent).toContain('revoked');
    expect(rows()[0].querySelector('button')).toBeNull();
  });

  it('says why a revoke failed', async () => {
    listRequest().flush(page([token(1)]));
    await settle();
    (el().querySelector('tbody button') as HTMLButtonElement).click();
    await settle();
    confirm();

    http
      .expectOne((r) => r.method === 'DELETE')
      .flush(null, { status: 403, statusText: 'Forbidden' });
    await settle();

    expect(el().querySelector('[role="alert"]')?.textContent).toContain(
      'Only an administrator can do this',
    );
    expect(rows()[0].querySelector('button')).not.toBeNull();
  });
});
