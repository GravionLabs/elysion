import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { AdminRoom, Page } from './admin-api';
import { AdminRooms } from './admin-rooms';

const room = (n: number): AdminRoom => ({
  id: `r${n}`,
  name: `Room ${n}`,
  owner: n === 3 ? null : { id: `u${n}`, displayName: `Owner ${n}` },
  memberCount: n,
  groupCount: 1,
  boardCount: 10 * n,
  createdAt: '2026-09-01T10:00:00Z',
});

const page = (items: AdminRoom[], total = items.length, number = 1): Page<AdminRoom> => ({
  items,
  total,
  page: number,
  pageSize: 25,
});

describe('AdminRooms', () => {
  let fixture: ComponentFixture<AdminRooms>;
  let http: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;
  const rows = () => [...el().querySelectorAll('tbody tr')];
  const listRequest = (query = '', pageNumber = 1) =>
    http.expectOne(
      (r) =>
        r.url === '/api/admin/rooms' &&
        r.params.get('page') === String(pageNumber) &&
        r.params.get('query') === (query || null),
    );

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminRooms],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AdminRooms);
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  const answer = async (rooms: AdminRoom[], own: { id: string; role: string }[] = []) => {
    listRequest().flush(page(rooms));
    http.expectOne('/api/rooms').flush(own.map((r) => ({ ...r, name: r.id, createdAt: '' })));
    await fixture.whenStable();
  };

  it('lists the rooms with owner and numbers, and never a board name', async () => {
    await answer([room(1), room(3)]);

    expect([...el().querySelectorAll('thead th')].map((th) => th.textContent?.trim())).toEqual([
      'Name',
      'Owner',
      'Members',
      'Groups',
      'Boards',
      'Created',
      'Actions',
    ]);
    const cells = [...rows()[0].querySelectorAll('th, td')].map((c) => c.textContent?.trim());
    expect(cells.slice(0, 5)).toEqual(['Room 1', 'Owner 1', '1', '1', '10']);
    expect(rows()[1].querySelectorAll('td')[0].textContent?.trim()).toBe('');
  });

  it('offers Share only for a room the administrator owns, and opens its dialog', async () => {
    await answer(
      [room(1), room(2)],
      [
        { id: 'r1', role: 'Owner' },
        { id: 'r2', role: 'Viewer' },
      ],
    );

    expect(rows()[0].querySelector('button')?.getAttribute('aria-label')).toBe(
      'Share the room Room 1',
    );
    expect(rows()[1].querySelector('button')).toBeNull();

    (rows()[0].querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(el().querySelector('app-share-dialog')).toBeTruthy();
    http.expectOne('/api/rooms/r1/members').flush([]);
    http.expectOne('/api/rooms/r1/invitations').flush([]);
  });

  it('searches and pages', async () => {
    await answer([room(1)]);
    const input = el().querySelector('input[type="search"]') as HTMLInputElement;
    input.value = 'team';
    input.dispatchEvent(new Event('input'));
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    listRequest('team').flush(page([room(1)], 60));
    await fixture.whenStable();
    ([...el().querySelectorAll('.pager button')][1] as HTMLButtonElement).click();
    await fixture.whenStable();
    listRequest('team', 2).flush(page([room(26)], 60, 2));
    await fixture.whenStable();

    expect(el().querySelector('.pager-text')?.textContent).toContain('Page 2 of 3');
  });

  it('says it when nothing matches and when the list cannot be loaded', async () => {
    listRequest().flush(null, { status: 500, statusText: 'Server Error' });
    http.expectOne('/api/rooms').flush([]);
    await fixture.whenStable();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');

    (el().querySelector('[role="alert"] button') as HTMLButtonElement).click();
    listRequest().flush(page([]));
    await fixture.whenStable();
    expect(el().textContent).toContain('No room matches');
  });
});
