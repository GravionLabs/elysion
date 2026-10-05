import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { Board } from './board/board';
import { BoardList } from './board-list/board-list';

/** A board id becomes a Yjs room name, so an empty or whitespace-only one is never usable. */
export const boardIdGuard: CanActivateFn = (route) =>
  route.paramMap.get('boardId')?.trim() ? true : inject(Router).createUrlTree(['/']);

// The route param is called `boardId` so `withComponentInputBinding()` hands it to `Board.boardId`.
export const routes: Routes = [
  { path: '', pathMatch: 'full', component: BoardList },
  { path: 'board/:boardId', component: Board, canActivate: [boardIdGuard] },
  { path: '**', redirectTo: '' },
];
