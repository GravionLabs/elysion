import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { Router, provideRouter } from '@angular/router';
import { Invite } from './invite';

describe('Invite', () => {
  let fixture: ComponentFixture<Invite>;
  let http: HttpTestingController;
  let router: Router;
  let location: Location;
  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [Invite],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    location = TestBed.inject(Location);
    vi.spyOn(location, 'replaceState');
    fixture = TestBed.createComponent(Invite);
    fixture.componentRef.setInput('token', 'secret-token');
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  it('uses the link, takes the token out of the address and opens the board', async () => {
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    expect(location.replaceState).toHaveBeenCalledWith('/invite');
    expect(el().textContent).toContain('Joining');

    const request = http.expectOne('/api/invitations/secret-token/accept');
    expect(request.request.method).toBe('POST');
    request.flush({ kind: 'board', id: 'b1', role: 'Viewer' });

    expect(navigate).toHaveBeenCalledWith('/board/b1', { replaceUrl: true });
  });

  it('opens a room for a room link', async () => {
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    http
      .expectOne('/api/invitations/secret-token/accept')
      .flush({ kind: 'room', id: 'r1', role: 'Editor' });

    expect(navigate).toHaveBeenCalledWith('/rooms/r1', { replaceUrl: true });
  });

  it.each([
    [410, 'does not work any more'],
    [404, 'is not valid'],
    [500, 'could not be used'],
  ])('says so for a %i, with a way back to the boards', async (status, text) => {
    http
      .expectOne('/api/invitations/secret-token/accept')
      .flush({ title: 'x' }, { status, statusText: 'x' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el().querySelector('h1')?.textContent).toContain(text);
    expect(el().querySelector('[role="alert"]')).not.toBeNull();
    expect(el().querySelector('a')?.getAttribute('href')).toBe('/');
  });

  it('uses the link once, however often the input is set', async () => {
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture.componentRef.setInput('token', 'other');
    await fixture.whenStable();

    http
      .expectOne('/api/invitations/secret-token/accept')
      .flush({ kind: 'board', id: 'b', role: 'Viewer' });
    http.expectNone('/api/invitations/other/accept');
  });
});
