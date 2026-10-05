import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { Board } from './board/board';
import { CanvasElementLoader } from './board/canvas-element-loader';
import { BoardList } from './board-list/board-list';

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

  it('opens the board list at /', async () => {
    await harness.navigateByUrl('/', BoardList);

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
});
