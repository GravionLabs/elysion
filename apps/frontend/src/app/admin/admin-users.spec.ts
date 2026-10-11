import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { AdminUser, Page } from './admin-api';
import { AdminUsers } from './admin-users';

const user = (n: number, groups: string[] = []): AdminUser => ({
  id: `u${n}`,
  displayName: `Person ${n}`,
  email: `p${n}@example.com`,
  createdAt: '2026-09-01T10:00:00Z',
  lastSeenAt: n === 2 ? null : '2026-10-10T10:00:00Z',
  groups: groups.map((name, i) => ({ id: `g${i}`, name })),
});

const page = (items: AdminUser[], total = items.length, number = 1): Page<AdminUser> => ({
  items,
  total,
  page: number,
  pageSize: 25,
});

describe('AdminUsers', () => {
  let fixture: ComponentFixture<AdminUsers>;
  let http: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;
  const rows = () => [...el().querySelectorAll('tbody tr')];
  const settle = () => fixture.whenStable();
  const listRequest = (query = '', pageNumber = 1) =>
    http.expectOne(
      (r) =>
        r.url === '/api/admin/users' &&
        r.params.get('page') === String(pageNumber) &&
        r.params.get('query') === (query || null),
    );

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminUsers],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AdminUsers);
    await settle();
  });

  afterEach(() => http.verify());

  it('lists the people with their groups as chips, when they were last seen and made', async () => {
    listRequest().flush(page([user(1, ['Design', 'Dev']), user(2)]));
    await settle();

    expect(rows().length).toBe(2);
    const first = rows()[0];
    expect(first.querySelector('th')?.textContent).toContain('Person 1');
    expect(first.textContent).toContain('p1@example.com');
    expect([...first.querySelectorAll('.chip')].map((c) => c.textContent)).toEqual([
      'Design',
      'Dev',
    ]);
    expect(rows()[1].textContent).toContain('never');
    expect(el().querySelectorAll('thead th').length).toBe(5);
  });

  it('searches with the text, from the first page', async () => {
    listRequest().flush(page([user(1)]));
    await settle();

    const input = el().querySelector('input[type="search"]') as HTMLInputElement;
    input.value = '  ada ';
    input.dispatchEvent(new Event('input'));
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();

    listRequest('ada').flush(page([]));
    await settle();
    expect(el().textContent).toContain('No user matches');
  });

  it('pages: next asks for the second page', async () => {
    listRequest().flush(page([user(1)], 60));
    await settle();
    expect(el().querySelector('.pager-text')?.textContent).toContain('Page 1 of 3, 60 in all');

    const next = [...el().querySelectorAll('.pager button')][1] as HTMLButtonElement;
    next.click();
    await settle();
    listRequest('', 2).flush(page([user(26)], 60, 2));
    await settle();

    expect(el().querySelector('.pager-text')?.textContent).toContain('Page 2 of 3');
  });

  it('says it when the list cannot be loaded and tries again', async () => {
    listRequest().flush(null, { status: 500, statusText: 'Server Error' });
    await settle();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');

    (el().querySelector('[role="alert"] button') as HTMLButtonElement).click();
    listRequest().flush(page([user(1)]));
    await settle();
    expect(rows().length).toBe(1);
  });

  it('opens the rooms and boards of a person in a dialog, roles only', async () => {
    listRequest().flush(page([user(1)]));
    await settle();

    (rows()[0].querySelector('button.link') as HTMLButtonElement).click();
    await settle();
    http.expectOne('/api/admin/users/u1').flush({
      ...user(1),
      rooms: [{ id: 'r1', name: 'Team room', role: 'Owner' }],
      boards: [{ id: 'b1', name: 'Retro', role: 'Editor' }],
    });
    await settle();

    const dialog = el().querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('h2')?.textContent).toBe('Person 1');
    expect(dialog.textContent).toContain('Team room');
    expect(dialog.textContent).toContain('Owner');
    expect(dialog.textContent).toContain('Retro');
    expect(dialog.textContent).toContain('Editor');

    (dialog.querySelector('.close') as HTMLButtonElement).click();
    await settle();
    expect(el().querySelector('[role="dialog"]')).toBeNull();
  });

  it('says it when the details cannot be loaded', async () => {
    listRequest().flush(page([user(1)]));
    await settle();

    (rows()[0].querySelector('button.link') as HTMLButtonElement).click();
    await settle();
    http.expectOne('/api/admin/users/u1').flush(null, { status: 404, statusText: 'Not Found' });
    await settle();

    expect(el().querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain(
      'could not be loaded',
    );
  });
});
