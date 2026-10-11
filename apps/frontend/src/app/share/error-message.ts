import { HttpErrorResponse } from '@angular/common/http';
import type { MemberScope } from './members-api';

/** The message to show for a failed call: the API's own where it has one, else a general one. */
export function describeError(
  error: unknown,
  fallback: string,
  scope: MemberScope = 'board',
): string {
  if (error instanceof HttpErrorResponse) {
    const message = (error.error as { message?: unknown } | null)?.message;
    if (typeof message === 'string' && message.trim() !== '') {
      return message;
    }
    if (error.status === 403) {
      return scope === 'room'
        ? $localize`:@@share.error.ownerOnlyRoom:Only an owner of the room can do this.`
        : $localize`:@@share.error.ownerOnlyBoard:Only an owner of the board can do this.`;
    }
  }
  return fallback;
}
