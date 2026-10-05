import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { Board } from './board/board';
import { CanvasElementLoader } from './board/canvas-element-loader';

describe('routes', () => {
  let harness: RouterTestingHarness;
  let router: Router;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withComponentInputBinding()),
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

  it('redirects / to the default board', async () => {
    const board = await harness.navigateByUrl('/', Board);

    expect(router.url).toBe('/board/default');
    expect(board.boardId()).toBe('default');
  });

  it('redirects unknown paths to the default board', async () => {
    await harness.navigateByUrl('/nowhere/at/all', Board);

    expect(router.url).toBe('/board/default');
  });

  it('does not connect to a room named with only whitespace', async () => {
    await harness.navigateByUrl('/board/%20%20', Board);

    expect(router.url).toBe('/board/default');
  });
});
