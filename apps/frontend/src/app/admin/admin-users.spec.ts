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

  describe('deactivating and handing over (#668)', () => {
    const detail = (n: number, extra: Record<string, unknown> = {}) => ({
      ...user(n),
      rooms: [{ id: 'r1', name: 'Team room', role: 'Owner' }],
      boards: [
        { id: 'b1', name: 'Retro', role: 'Owner' },
        { id: 'b2', name: 'Other', role: 'Editor' },
      ],
      ...extra,
    });

    const openDetail = async (loaded: Record<string, unknown>) => {
      listRequest().flush(page([user(1)]));
      await settle();
      (rows()[0].querySelector('button.link') as HTMLButtonElement).click();
      await settle();
      http.expectOne('/api/admin/users/u1').flush(loaded);
      await settle();
    };
    const dialogs = () => [...el().querySelectorAll('[role="dialog"]')];
    const button = (root: Element, text: RegExp) =>
      [...root.querySelectorAll('button')].find((b) => text.test((b.textContent ?? '').trim())) as
        HTMLButtonElement | undefined;

    it('marks a deactivated person in the list', async () => {
      listRequest().flush(page([{ ...user(1), deactivatedAt: '2026-10-10T10:00:00Z' }, user(2)]));
      await settle();

      expect(rows()[0].querySelector('.chip')?.textContent).toContain('deactivated');
      expect(rows()[1].querySelector('.chip')).toBeNull();
    });

    it('asks first, and deactivates with the identity provider named in the question', async () => {
      await openDetail(detail(1));

      button(dialogs()[0], /^Deactivate/)!.click();
      await settle();
      expect(dialogs().length).toBe(2);
      expect(dialogs()[1].textContent).toContain('identity provider');

      button(dialogs()[1], /^Deactivate$/)!.click();
      await settle();
      const request = http.expectOne('/api/admin/users/u1/deactivate');
      expect(request.request.method).toBe('POST');
      request.flush(detail(1, { deactivatedAt: '2026-10-11T10:00:00Z' }));
      await settle();

      expect(dialogs().length).toBe(1);
      expect(dialogs()[0].textContent).toContain('Deactivated on');
      expect(rows()[0].querySelector('.chip')?.textContent).toContain('deactivated');
    });

    it('does not deactivate when the question is canceled', async () => {
      await openDetail(detail(1));
      button(dialogs()[0], /^Deactivate/)!.click();
      await settle();

      button(dialogs()[1], /^Cancel$/)!.click();
      await settle();

      expect(dialogs().length).toBe(1);
      http.expectNone('/api/admin/users/u1/deactivate');
    });

    it('says why when it did not work', async () => {
      await openDetail(detail(1));
      button(dialogs()[0], /^Deactivate/)!.click();
      await settle();
      button(dialogs()[1], /^Deactivate$/)!.click();
      await settle();

      http
        .expectOne('/api/admin/users/u1/deactivate')
        .flush(
          { detail: 'You cannot deactivate yourself.' },
          { status: 409, statusText: 'Conflict' },
        );
      await settle();

      expect(dialogs()[0].querySelector('[role="alert"]')?.textContent).toContain(
        'cannot deactivate yourself',
      );
    });

    it('reactivates a deactivated person', async () => {
      await openDetail(detail(1, { deactivatedAt: '2026-10-11T10:00:00Z' }));

      button(dialogs()[0], /^Reactivate$/)!.click();
      await settle();
      http.expectOne('/api/admin/users/u1/reactivate').flush(detail(1));
      await settle();

      expect(dialogs()[0].textContent).toContain('can use Elysion');
    });

    it('offers no hand-over for somebody who is not deactivated, or who owns nothing', async () => {
      await openDetail(detail(1));
      expect(el().querySelector('input[name="receiver"]')).toBeNull();
    });

    it('offers the hand-over with the counts, finds somebody else, asks and hands over', async () => {
      await openDetail(detail(1, { deactivatedAt: '2026-10-11T10:00:00Z' }));
      const dialog = dialogs()[0];
      expect(dialog.textContent).toContain('Owned by this person: boards 1, rooms 1');

      const input = dialog.querySelector('input[name="receiver"]') as HTMLInputElement;
      input.value = 'per';
      input.dispatchEvent(new Event('input'));
      dialog.querySelector('form')!.dispatchEvent(new Event('submit'));
      await settle();
      http
        .expectOne((r) => r.url === '/api/admin/users' && r.params.get('query') === 'per')
        .flush(page([user(1), { ...user(2), deactivatedAt: '2026-10-01T00:00:00Z' }, user(3)]));
      await settle();

      // The giver and a deactivated person are not offered.
      const offered = [
        ...dialog.querySelectorAll('[aria-labelledby="user-handover-title"] .line'),
      ].map((l) => l.textContent);
      expect(offered.length).toBe(1);
      expect(offered[0]).toContain('Person 3');

      button(dialog, /^Hand over$/)!.click();
      await settle();
      expect(dialogs()[1].textContent).toContain('Person 3');
      button(dialogs()[1], /^Hand over$/)!.click();
      await settle();
      const request = http.expectOne('/api/admin/boards/transfer');
      expect(request.request.body).toEqual({ fromUserId: 'u1', toUserId: 'u3' });
      request.flush({ boards: 2, rooms: 1 });
      await settle();
      http.expectOne('/api/admin/users/u1').flush(
        detail(1, {
          deactivatedAt: '2026-10-11T10:00:00Z',
          rooms: [],
          boards: [{ id: 'b2', name: 'Other', role: 'Editor' }],
        }),
      );
      await settle();

      expect(dialogs().length).toBe(1);
      expect(dialogs()[0].textContent).toContain('Handed over: boards 2, rooms 1');
      expect(dialogs()[0].querySelector('input[name="receiver"]')).toBeNull();
    });
  });
});
