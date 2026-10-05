import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { Board } from './board/board';

/** The board that `/` opens until the board list (#102) exists. */
export const DEFAULT_BOARD_ID = 'default';

/** A board id becomes a Yjs room name, so an empty or whitespace-only one is never usable. */
export const boardIdGuard: CanActivateFn = (route) =>
  route.paramMap.get('boardId')?.trim()
    ? true
    : inject(Router).createUrlTree(['board', DEFAULT_BOARD_ID]);

// The route param is called `boardId` so `withComponentInputBinding()` hands it to `Board.boardId`.
export const routes: Routes = [
  { path: 'board/:boardId', component: Board, canActivate: [boardIdGuard] },
  { path: '', pathMatch: 'full', redirectTo: `board/${DEFAULT_BOARD_ID}` },
  { path: '**', redirectTo: `board/${DEFAULT_BOARD_ID}` },
];
