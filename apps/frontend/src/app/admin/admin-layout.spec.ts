import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Account } from '../auth/account';
import { provideFakeSession } from '../auth/testing';
import { AdminLayout } from './admin-layout';

describe('AdminLayout', () => {
  let fixture: ComponentFixture<AdminLayout>;
  let http: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminLayout],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideFakeSession(),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AdminLayout);
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  it('asks who the person is when the page is opened by its address, and waits for the answer', () => {
    http.expectOne('/api/auth/me');

    expect(el().querySelector('[role="status"]')?.textContent).toContain('Checking your access');
    expect(el().querySelector('nav[aria-label="Administration"]')).toBeNull();
  });

  it('shows the navigation to an administrator', async () => {
    http.expectOne('/api/auth/me').flush({ id: 'u', isAdministrator: true });
    await fixture.whenStable();

    const links = [...el().querySelectorAll('nav[aria-label="Administration"] a')];
    expect(links.map((a) => [a.textContent?.trim(), a.getAttribute('href')])).toEqual([
      ['Overview', '/admin'],
      ['Users', '/admin/users'],
      ['Groups', '/admin/groups'],
      ['Rooms', '/admin/rooms'],
      ['Access tokens', '/admin/tokens'],
      ['Audit', '/admin/audit'],
    ]);
    expect(el().querySelector('router-outlet')).toBeTruthy();
    expect(el().querySelector('.denied')).toBeNull();
  });

  it('tells everybody else that they are not an administrator, with a way back', async () => {
    http.expectOne('/api/auth/me').flush({ id: 'u', isAdministrator: false });
    await fixture.whenStable();

    expect(el().querySelector('h1')?.textContent).toContain('You are not an administrator');
    expect(el().querySelector('.denied a')?.getAttribute('href')).toBe('/');
    expect(el().querySelector('nav[aria-label="Administration"]')).toBeNull();
    expect(el().querySelector('router-outlet')).toBeNull();
  });

  it('does not ask again when the answer is already known', () => {
    http.expectOne('/api/auth/me');
    expect(TestBed.inject(Account).isAdministrator()).toBeNull();
  });
});
