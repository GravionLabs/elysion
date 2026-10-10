import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes, UrlMatcher } from '@angular/router';
import { autoLoginPartialRoutesGuard } from 'angular-auth-oidc-client';

/** A board id becomes a Yjs room name, so an empty or whitespace-only one is never usable. */
export const boardIdGuard: CanActivateFn = (route) =>
  route.paramMap.get('boardId')?.trim() ? true : inject(Router).createUrlTree(['/']);

/**
 * The board list and its views: `/` (all boards), `/rooms/none` (boards that are in no room) and `/rooms/:roomId`.
 * One route, so the same `BoardList` stays in place while the user moves between views (the list is not loaded
 * again); the matcher hands `roomId` to its input.
 */
export const boardListMatcher: UrlMatcher = (segments) => {
  if (segments.length === 0) {
    return { consumed: [] };
  }
  if (segments.length === 2 && segments[0].path === 'rooms') {
    return { consumed: segments, posParams: { roomId: segments[1] } };
  }
  return null;
};

// The route param is called `boardId` so `withComponentInputBinding()` hands it to `Board.boardId`.
/**
 * The routes, behind a login guard. Everything needs a login: a user who is not signed in is sent to the identity
 * provider and comes back here. The guard is a parameter so the routes can be tested without the login library.
 */
export function buildRoutes(loginGuard: CanActivateFn): Routes {
  return [
    // Each page is a chunk of its own (#710): the first load holds the shell and the login, not the board and its dialogs.
    {
      matcher: boardListMatcher,
      loadComponent: () => import('./board-list/board-list').then((m) => m.BoardList),
      canActivate: [loginGuard],
    },
    {
      path: 'board/:boardId',
      loadComponent: () => import('./board/board').then((m) => m.Board),
      canActivate: [boardIdGuard, loginGuard],
    },
    { path: '**', redirectTo: '' },
  ];
}

export const routes: Routes = buildRoutes(autoLoginPartialRoutesGuard);
