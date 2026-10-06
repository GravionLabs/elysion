import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { autoLoginPartialRoutesGuard } from 'angular-auth-oidc-client';
import { Board } from './board/board';
import { BoardList } from './board-list/board-list';

/** A board id becomes a Yjs room name, so an empty or whitespace-only one is never usable. */
export const boardIdGuard: CanActivateFn = (route) =>
  route.paramMap.get('boardId')?.trim() ? true : inject(Router).createUrlTree(['/']);

// The route param is called `boardId` so `withComponentInputBinding()` hands it to `Board.boardId`.
/**
 * The routes, behind a login guard. Everything needs a login: a user who is not signed in is sent to the identity
 * provider and comes back here. The guard is a parameter so the routes can be tested without the login library.
 */
export function buildRoutes(loginGuard: CanActivateFn): Routes {
  return [
    { path: '', pathMatch: 'full', component: BoardList, canActivate: [loginGuard] },
    { path: 'board/:boardId', component: Board, canActivate: [boardIdGuard, loginGuard] },
    { path: '**', redirectTo: '' },
  ];
}

export const routes: Routes = buildRoutes(autoLoginPartialRoutesGuard);
