import { TestBed } from '@angular/core/testing';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { BehaviorSubject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SessionService, colorFor, toSessionUser } from './session.service';

describe('toSessionUser', () => {
  it('names the user from the username, then the name, then the email, then the id', () => {
    const base = { sub: 'kc-1' };

    expect(
      toSessionUser({ ...base, preferred_username: 'ada', name: 'Ada L', email: 'a@x.y' })?.name,
    ).toBe('ada');
    expect(toSessionUser({ ...base, name: 'Ada L', email: 'a@x.y' })?.name).toBe('Ada L');
    expect(toSessionUser({ ...base, email: 'a@x.y' })?.name).toBe('a@x.y');
    expect(toSessionUser(base)?.name).toBe('kc-1');
  });

  it('carries the id, the email and a color derived from the id', () => {
    const user = toSessionUser({ sub: 'kc-1', email: 'a@x.y', preferred_username: 'ada' });

    expect(user).toEqual({ id: 'kc-1', name: 'ada', email: 'a@x.y', color: colorFor('kc-1') });
  });

  it('has no email when there is none', () => {
    expect(toSessionUser({ sub: 'kc-1' })?.email).toBeNull();
  });

  it('ignores blank and non-text claims', () => {
    const user = toSessionUser({ sub: 'kc-1', preferred_username: '  ', name: 42, email: '' });

    expect(user).toMatchObject({ name: 'kc-1', email: null });
  });

  it('is null without a usable subject', () => {
    for (const claims of [null, undefined, {}, { sub: '' }, { sub: '  ' }, { sub: 7 }, 'text']) {
      expect(toSessionUser(claims)).toBeNull();
    }
  });
});

describe('colorFor', () => {
  it('gives an id the same color every time, one of the design tokens', () => {
    expect(colorFor('kc-1')).toBe(colorFor('kc-1'));
    expect(colorFor('kc-1')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('spreads ids over the palette', () => {
    const colors = new Set(Array.from({ length: 200 }, (_, i) => colorFor(`id-${i}`)));

    expect(colors.size).toBe(8);
  });
});

describe('SessionService', () => {
  function setup() {
    const userData$ = new BehaviorSubject<{ userData: unknown }>({ userData: null });
    const oidc = {
      userData$,
      logoff: vi.fn(() => of(null)),
      logoffLocal: vi.fn(),
      authorize: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: OidcSecurityService, useValue: oidc }],
    });
    return { service: TestBed.inject(SessionService), oidc, userData$ };
  }

  it('has no user before the login is complete', () => {
    const { service } = setup();

    expect(service.user()).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
  });

  it('follows the user data of the login library', () => {
    const { service, userData$ } = setup();

    userData$.next({ userData: { sub: 'kc-1', preferred_username: 'ada' } });
    expect(service.user()).toMatchObject({ id: 'kc-1', name: 'ada' });
    expect(service.isAuthenticated()).toBe(true);

    userData$.next({ userData: null });
    expect(service.user()).toBeNull();
  });

  it('logs out at the identity provider too', () => {
    const { service, oidc } = setup();

    service.logout();

    expect(oidc.logoff).toHaveBeenCalledOnce();
  });

  it('restarts the login: forgets the local session first, then goes to the identity provider', () => {
    const { service, oidc } = setup();
    const order: string[] = [];
    oidc.logoffLocal.mockImplementation(() => order.push('logoffLocal'));
    oidc.authorize.mockImplementation(() => order.push('authorize'));

    service.restartLogin();

    expect(order).toEqual(['logoffLocal', 'authorize']);
  });
});
