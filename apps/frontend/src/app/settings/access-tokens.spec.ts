import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { provideFakeSession } from '../auth/testing';
import { AccessTokens } from './access-tokens';
import type { AccessTokenItem, CreatedAccessToken } from './access-tokens-api';

const token = (n: number, extra: Partial<AccessTokenItem> = {}): AccessTokenItem => ({
  id: `t${n}`,
  name: `Token ${n}`,
  prefix: `elp_abcd000${n}`,
  scopes: ['boards:read'],
  createdAt: '2026-10-01T10:00:00Z',
  lastUsedAt: null,
  expiresAt: '2026-12-01T10:00:00Z',
  ...extra,
});

const SECRET = `elp_${'S'.repeat(43)}`;

describe('AccessTokens', () => {
  let fixture: ComponentFixture<AccessTokens>;
  let http: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;
  const rows = () => [...el().querySelectorAll('tbody tr')];
  const settle = () => fixture.whenStable();
  const button = (text: string) =>
    [...el().querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as
      HTMLButtonElement | undefined;
  const type = (selector: string, value: string) => {
    const input = el().querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  const tick = (scope: string, on: boolean) => {
    const box = [...el().querySelectorAll('.scope')]
      .find((label) => label.querySelector('code')?.textContent === scope)
      ?.querySelector('input') as HTMLInputElement;
    box.checked = on;
    box.dispatchEvent(new Event('change'));
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AccessTokens],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideFakeSession(),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AccessTokens);
    await settle();
  });

  afterEach(() => http.verify());

  it('lists the tokens with their start, scopes, last use and expiry', async () => {
    http
      .expectOne('/api/access-tokens')
      .flush([
        token(1, { lastUsedAt: '2026-10-20T08:00:00Z', scopes: ['boards:read', 'boards:write'] }),
        token(2),
      ]);
    await settle();

    expect(rows().length).toBe(2);
    expect(rows()[0].querySelector('th')?.textContent).toContain('Token 1');
    expect(rows()[0].textContent).toContain('elp_abcd0001…');
    expect([...rows()[0].querySelectorAll('.chip')].map((c) => c.textContent)).toEqual([
      'boards:read',
      'boards:write',
    ]);
    expect(rows()[1].textContent).toContain('never');
  });

  it('marks an expired token', async () => {
    http
      .expectOne('/api/access-tokens')
      .flush([token(1, { expiresAt: '2020-01-01T00:00:00Z' }), token(2)]);
    await settle();

    expect(rows()[0].textContent).toContain('expired');
    expect(rows()[1].textContent).not.toContain('expired');
  });

  it('says so when there is none, and when the list cannot be loaded, with a retry', async () => {
    http.expectOne('/api/access-tokens').flush('no', { status: 502, statusText: 'Bad Gateway' });
    await settle();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain(
      'The tokens could not be loaded',
    );

    button('Try again')!.click();
    http.expectOne('/api/access-tokens').flush([]);
    await settle();
    expect(el().textContent).toContain('You have no access tokens');
  });

  it('makes a token with the name, the scopes in their order and the expiry, and shows the secret once', async () => {
    http.expectOne('/api/access-tokens').flush([token(1)]);
    await settle();
    expect(button('Create token')!.disabled).toBe(true);

    type('input[name="name"]', '  Sprint script ');
    tick('webhooks:write', true);
    tick('boards:write', true);
    const expiry = el().querySelector('select[name="expiry"]') as HTMLSelectElement;
    expiry.value = '90';
    expiry.dispatchEvent(new Event('change'));
    await settle();
    el().querySelector('.create form')!.dispatchEvent(new Event('submit'));

    const request = http.expectOne((r) => r.method === 'POST' && r.url === '/api/access-tokens');
    expect(request.request.body).toEqual({
      name: 'Sprint script',
      scopes: ['boards:read', 'boards:write', 'webhooks:write'],
      expiresInDays: 90,
    });
    const created: CreatedAccessToken = { ...token(9, { name: 'Sprint script' }), token: SECRET };
    request.flush(created);
    await settle();

    const secret = el().querySelector('.secret-value') as HTMLInputElement;
    expect(secret.value).toBe(SECRET);
    expect(el().querySelector('.secret')?.textContent).toContain('shown only this once');
    expect(rows().map((r) => r.querySelector('th')?.textContent?.trim())).toEqual([
      'Sprint script',
      'Token 1',
    ]);
    // The list never holds the secret.
    expect(el().querySelector('tbody')?.textContent).not.toContain(SECRET);

    button('I have copied it')!.click();
    await settle();
    expect(el().querySelector('.secret')).toBeNull();
    expect(el().textContent).not.toContain(SECRET);
  });

  it('cannot make a token without a name or without a scope', async () => {
    http.expectOne('/api/access-tokens').flush([]);
    await settle();

    type('input[name="name"]', '   ');
    await settle();
    expect(button('Create token')!.disabled).toBe(true);

    type('input[name="name"]', 'Script');
    tick('boards:read', false);
    await settle();
    expect(button('Create token')!.disabled).toBe(true);

    tick('members:write', true);
    await settle();
    expect(button('Create token')!.disabled).toBe(false);
  });

  it('copies the secret with the button', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    http.expectOne('/api/access-tokens').flush([]);
    await settle();
    type('input[name="name"]', 'Script');
    el().querySelector('.create form')!.dispatchEvent(new Event('submit'));
    http
      .expectOne((r) => r.method === 'POST')
      .flush({ ...token(9), token: SECRET } satisfies CreatedAccessToken);
    await settle();

    button('Copy')!.click();
    await settle();

    expect(writeText).toHaveBeenCalledWith(SECRET);
    expect(button('Copied')).toBeDefined();
  });

  it('shows the message of a refused token', async () => {
    http.expectOne('/api/access-tokens').flush([]);
    await settle();
    type('input[name="name"]', 'Script');
    el().querySelector('.create form')!.dispatchEvent(new Event('submit'));

    http
      .expectOne((r) => r.method === 'POST')
      .flush(
        { message: 'You have 50 active tokens. Revoke one you no longer use first.' },
        { status: 409, statusText: 'Conflict' },
      );
    await settle();

    expect(el().querySelector('.create [role="alert"]')?.textContent).toContain(
      'You have 50 active tokens',
    );
    expect(el().querySelector('.secret')).toBeNull();
  });

  it('revokes a token after asking, and it leaves the list', async () => {
    http.expectOne('/api/access-tokens').flush([token(1), token(2)]);
    await settle();

    (el().querySelector('button[aria-label="Revoke Token 1"]') as HTMLButtonElement).click();
    await settle();
    expect(el().querySelector('[role="dialog"]')?.textContent).toContain('Revoke “Token 1”?');

    const confirm = [...el().querySelectorAll('[role="dialog"] button')].find(
      (b) => b.textContent?.trim() === 'Revoke',
    ) as HTMLButtonElement;
    confirm.click();
    http.expectOne((r) => r.method === 'DELETE' && r.url === '/api/access-tokens/t1').flush(null);
    await settle();

    expect(el().querySelector('[role="dialog"]')).toBeNull();
    expect(rows().map((r) => r.querySelector('th')?.textContent?.trim())).toEqual(['Token 2']);
  });

  it('keeps a token whose revoke failed and says so', async () => {
    http.expectOne('/api/access-tokens').flush([token(1)]);
    await settle();
    (el().querySelector('button[aria-label="Revoke Token 1"]') as HTMLButtonElement).click();
    await settle();
    (
      [...el().querySelectorAll('[role="dialog"] button')].find(
        (b) => b.textContent?.trim() === 'Revoke',
      ) as HTMLButtonElement
    ).click();

    http
      .expectOne((r) => r.method === 'DELETE')
      .flush('x', { status: 502, statusText: 'Bad Gateway' });
    await settle();

    expect(rows().length).toBe(1);
    expect(el().querySelector('[role="alert"]')?.textContent).toContain(
      'The token could not be revoked',
    );
  });
});
