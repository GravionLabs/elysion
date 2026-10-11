import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AdminOverview } from './admin-overview';

const STATS = { users: 12, usersSeenLast30Days: 9, groups: 3, rooms: 4, boards: 57 };

describe('AdminOverview', () => {
  let fixture: ComponentFixture<AdminOverview>;
  let http: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminOverview],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AdminOverview);
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  it('shows the four numbers as tiles, and how many people were seen lately', async () => {
    http.expectOne('/api/admin/stats').flush(STATS);
    http.expectOne('/auth-config.json').flush({});
    await fixture.whenStable();

    const tiles = [...el().querySelectorAll('.tile')].map((tile) =>
      [...tile.querySelectorAll('span')].map((s) => s.textContent?.trim()),
    );
    expect(tiles.map((t) => t.slice(0, 2))).toEqual([
      ['12', 'People'],
      ['3', 'Groups'],
      ['4', 'Rooms'],
      ['57', 'Boards'],
    ]);
    expect(tiles[0][2]).toContain('9 seen in the last 30 days');
  });

  it('names the identity provider from the login settings, and the provider the shell jumps to', async () => {
    http.expectOne('/api/admin/stats').flush(STATS);
    http
      .expectOne('/auth-config.json')
      .flush({ authority: 'https://idp.example/realms/elysion', idpHint: 'microsoft' });
    await fixture.whenStable();

    const facts = el().querySelector('.facts')!.textContent!;
    expect(facts).toContain('https://idp.example/realms/elysion');
    expect(facts).toContain('microsoft');
  });

  it('says so when there is no hint', async () => {
    http.expectOne('/api/admin/stats').flush(STATS);
    http.expectOne('/auth-config.json').flush({ authority: 'https://idp.example/realms/elysion' });
    await fixture.whenStable();

    expect(el().querySelector('.facts')!.textContent).toContain('None');
  });

  it('says it when the numbers cannot be loaded, and loads them again on request', async () => {
    http.expectOne('/api/admin/stats').flush(null, { status: 500, statusText: 'Server Error' });
    http.expectOne('/auth-config.json').flush({});
    await fixture.whenStable();

    expect(el().querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');
    (el().querySelector('[role="alert"] button') as HTMLButtonElement).click();
    http.expectOne('/api/admin/stats').flush(STATS);
    await fixture.whenStable();

    expect(el().querySelector('[role="alert"]')).toBeNull();
    expect(el().querySelectorAll('.tile').length).toBe(4);
  });

  it('shows the 403 of a person who is not an administrator as such', async () => {
    http.expectOne('/api/admin/stats').flush(null, { status: 403, statusText: 'Forbidden' });
    http.expectOne('/auth-config.json').flush({});
    await fixture.whenStable();

    expect(el().querySelector('[role="alert"]')?.textContent).toContain('Only an administrator');
  });
});
