import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { BoardVotingApi, BoardVoting } from './canvas-element';

/** The message for a refused voting call, in words: the server's rules (ADR 0029). */
export function votingErrorMessage(error: unknown): string {
  switch (error instanceof HttpErrorResponse ? error.status : 0) {
    case 400:
      return $localize`:@@board.voting.invalid:The voting needs a name of up to 80 characters and 1 to 100 votes per person.`;
    case 403:
      return $localize`:@@board.voting.forbidden:Only editors and owners can start, end and clear a voting.`;
    case 404:
      return $localize`:@@board.voting.notFound:This voting does not exist any more.`;
    case 409:
      return $localize`:@@board.voting.conflict:A voting is already open, or it is closed.`;
    default:
      return $localize`:@@board.voting.failed:The voting could not be changed.`;
  }
}

/**
 * What the canvas calls to reach the voting of a board (`votingApi` of `<elysion-canvas>`, ADR 0029): the BFF's routes under
 * `/api/boards/:id`. A refusal rejects with a message that is shown as it is; a vote that fails is not shown, the canvas
 * asks for the state again.
 */
@Injectable({ providedIn: 'root' })
export class VotingApi {
  readonly #http = inject(HttpClient);

  /** The voting of one board, as the canvas wants it. `boardId` is read at every call, so it follows the page. */
  forBoard(boardId: () => string): BoardVotingApi {
    const base = () => `/api/boards/${encodeURIComponent(boardId())}`;
    const refuse = async <T>(call: Promise<T>): Promise<T> => {
      try {
        return await call;
      } catch (error) {
        throw new Error(votingErrorMessage(error), { cause: error });
      }
    };
    return {
      get: () => firstValueFrom(this.#http.get<BoardVoting | null>(`${base()}/voting`)),
      start: (options) =>
        refuse(firstValueFrom(this.#http.post<BoardVoting>(`${base()}/votings`, options))),
      vote: (votingId, elementId) =>
        firstValueFrom(
          this.#http.post<BoardVoting>(`${base()}/votings/${encodeURIComponent(votingId)}/votes`, {
            elementId,
          }),
        ),
      retract: (votingId, elementId) =>
        firstValueFrom(
          this.#http.delete<BoardVoting | null>(
            `${base()}/votings/${encodeURIComponent(votingId)}/votes/${encodeURIComponent(elementId)}`,
          ),
        ),
      close: (votingId) =>
        refuse(
          firstValueFrom(
            this.#http.post<BoardVoting>(
              `${base()}/votings/${encodeURIComponent(votingId)}/close`,
              null,
            ),
          ),
        ),
      clear: () => refuse(firstValueFrom(this.#http.delete<void>(`${base()}/votings`))),
    };
  }
}
