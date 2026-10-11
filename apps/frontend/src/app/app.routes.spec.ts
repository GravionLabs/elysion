import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { autoLoginPartialRoutesGuard } from 'angular-auth-oidc-client';
import { buildRoutes, routes } from './app.routes';
import { provideFakeSession } from './auth/testing';
import { Board } from './board/board';
import { CanvasElementLoader } from './board/canvas-element-loader';
import { BoardList } from './board-list/board-list';
import { Invite } from './invite/invite';
import { AdminLayout } from './admin/admin-layout';
import { HttpTestingController } from '@angular/common/http/testing';

describe('routes', () => {
  let harness: RouterTestingHarness;
  let router: Router;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          buildRoutes(() => true),
          withComponentInputBinding(),
        ),
        provideFakeSession(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CanvasElementLoader, useValue: { load: () => Promise.resolve() } },
      ],
    });
    harness = await RouterTestingHarness.create();
    router = TestBed.inject(Router);
  });

  it('opens /board/:boardId and hands the id to the canvas element', async () => {
    const board = await harness.navigateByUrl('/board/team-retro', Board);

    expect(board.boardId()).toBe('team-retro');
    expect(
      harness.routeNativeElement?.querySelector('elysion-canvas')?.getAttribute('board-id'),
    ).toBe('team-retro');
  });

  it('keeps an id with special characters intact', async () => {
    const board = await harness.navigateByUrl('/board/q3%20plan%2Fv2', Board);

    expect(board.boardId()).toBe('q3 plan/v2');
  });

  it('opens an invitation link with the token as an input', async () => {
    const invite = await harness.navigateByUrl('/invite/abc-_123', Invite);

    expect(invite.token()).toBe('abc-_123');
    TestBed.inject(HttpTestingController)
      .expectOne('/api/invitations/abc-_123/accept')
      .flush({ kind: 'board', id: 'b1', role: 'Viewer' });
  });

  it('opens the administration: the frame asks who the person is, then the overview is in it', async () => {
    const http = TestBed.inject(HttpTestingController);
    await harness.navigateByUrl('/admin', AdminLayout);

    http.expectOne('/api/auth/me').flush({ id: 'u', isAdministrator: true });
    await harness.fixture.whenStable();
    http
      .expectOne('/api/admin/stats')
      .flush({ users: 1, usersSeenLast30Days: 1, groups: 0, rooms: 0, boards: 0 });
    http.expectOne('/auth-config.json').flush({});

    expect(harness.routeNativeElement?.querySelector('app-admin-overview')).toBeTruthy();
  });

  it('opens a page of the administration inside the frame', async () => {
    const http = TestBed.inject(HttpTestingController);
    await harness.navigateByUrl('/admin/users', AdminLayout);

    http.expectOne('/api/auth/me').flush({ id: 'u', isAdministrator: true });
    await harness.fixture.whenStable();
    http
      .expectOne((r) => r.url === '/api/admin/users')
      .flush({ items: [], total: 0, page: 1, pageSize: 25 });

    expect(harness.routeNativeElement?.querySelector('app-admin-users')).toBeTruthy();
  });

  it('shows no page of the administration to somebody who is not an administrator', async () => {
    const http = TestBed.inject(HttpTestingController);
    await harness.navigateByUrl('/admin/groups', AdminLayout);

    http.expectOne('/api/auth/me').flush({ id: 'u', isAdministrator: false });
    await harness.fixture.whenStable();

    expect(harness.routeNativeElement?.querySelector('app-admin-groups')).toBeNull();
    expect(harness.routeNativeElement?.textContent).toContain('You are not an administrator');
  });

  it('sends an unknown address under /admin to the overview', async () => {
    const http = TestBed.inject(HttpTestingController);
    await harness.navigateByUrl('/admin/nothing-here', AdminLayout);

    expect(router.url).toBe('/admin');
    http.expectOne('/api/auth/me');
  });

  it('opens the board list at /', async () => {
    await harness.navigateByUrl('/', BoardList);

    expect(router.url).toBe('/');
  });

  it('opens the board list for a room and for the boards in no room, with the view as the roomId input', async () => {
    const all = await harness.navigateByUrl('/', BoardList);
    expect(all.roomId()).toBeUndefined();

    const room = await harness.navigateByUrl(
      '/rooms/0197a8d2-1c3e-7a10-8000-0000000000b1',
      BoardList,
    );
    expect(room.roomId()).toBe('0197a8d2-1c3e-7a10-8000-0000000000b1');
    expect(router.url).toBe('/rooms/0197a8d2-1c3e-7a10-8000-0000000000b1');

    const none = await harness.navigateByUrl('/rooms/none', BoardList);
    expect(none.roomId()).toBe('none');
  });

  it('keeps the same board list in place while the user moves between its views', async () => {
    const first = await harness.navigateByUrl('/', BoardList);
    const second = await harness.navigateByUrl('/rooms/none', BoardList);
    const third = await harness.navigateByUrl('/', BoardList);

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(third.roomId()).toBeUndefined();
  });

  it('sends a malformed rooms path to the board list', async () => {
    await harness.navigateByUrl('/rooms', BoardList);
    expect(router.url).toBe('/');

    await harness.navigateByUrl('/rooms/a/b', BoardList);
    expect(router.url).toBe('/');
  });

  it('sends unknown paths to the board list', async () => {
    await harness.navigateByUrl('/nowhere/at/all', BoardList);

    expect(router.url).toBe('/');
  });

  it('does not connect to a room named with only whitespace', async () => {
    await harness.navigateByUrl('/board/%20%20', BoardList);

    expect(router.url).toBe('/');
  });

  it('still opens the room named default, which is not a stored board', async () => {
    const board = await harness.navigateByUrl('/board/default', Board);

    expect(board.boardId()).toBe('default');
  });

  describe('the login guard', () => {
    it("is on every page of the app, and the real routes use the login library's guard", () => {
      const pages = (list: ReturnType<typeof buildRoutes>) =>
        list.filter((route) => route.component || route.loadComponent);

      expect(pages(routes).length).toBe(3);
      // Each page is a chunk of its own (#710), not part of the first load.
      expect(pages(routes).every((route) => route.loadComponent && !route.component)).toBe(true);
      for (const route of pages(routes)) {
        expect(route.canActivate).toContain(autoLoginPartialRoutesGuard);
      }
    });

    it('keeps a user who is not signed in off the pages', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideRouter(
            buildRoutes(() => false),
            withComponentInputBinding(),
          ),
          provideHttpClient(),
          provideHttpClientTesting(),
          provideFakeSession(),
          { provide: CanvasElementLoader, useValue: { load: () => Promise.resolve() } },
        ],
      });
      const denied = await RouterTestingHarness.create();

      await denied.navigateByUrl('/board/team-retro');
      await denied.navigateByUrl('/');

      expect(denied.routeNativeElement?.querySelector('elysion-canvas') ?? null).toBeNull();
      expect(denied.routeNativeElement?.querySelector('app-top-bar') ?? null).toBeNull();
      expect(denied.routeNativeElement?.querySelector('main') ?? null).toBeNull();
    });
  });
});
