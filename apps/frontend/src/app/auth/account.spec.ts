import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Account } from './account';

describe('Account', () => {
  let http: HttpTestingController;
  let account: Account;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    account = TestBed.inject(Account);
  });

  afterEach(() => http.verify());

  it('does not know before it asked', () => {
    expect(account.isAdministrator()).toBeNull();
  });

  it('is an administrator when /api/auth/me says so, and asks only once', () => {
    account.load();
    account.load();

    http.expectOne('/api/auth/me').flush({ id: 'u1', isAdministrator: true });

    expect(account.isAdministrator()).toBe(true);
    account.load();
    http.expectNone('/api/auth/me');
  });

  it('is not one when the answer says no', () => {
    account.load();
    http.expectOne('/api/auth/me').flush({ id: 'u1', email: 'a@b.c', isAdministrator: false });

    expect(account.isAdministrator()).toBe(false);
  });

  it('is not one when the call fails: the interface then offers nothing', () => {
    account.load();
    http.expectOne('/api/auth/me').flush(null, { status: 500, statusText: 'Server Error' });

    expect(account.isAdministrator()).toBe(false);
  });
});
