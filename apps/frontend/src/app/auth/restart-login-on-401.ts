import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { SECURE_ROUTES } from './auth-settings';
import { SessionService } from './session.service';

/** Where the time of the last restart is kept, so a server that keeps refusing does not cause a redirect loop. */
export const LAST_RESTART_KEY = 'elysion.login-restarted-at';

/** A second `401` within this long after a restart is shown as an error instead of starting the login again. */
export const RESTART_COOLDOWN_MS = 15_000;

/**
 * A `401` from the API means the token was not accepted (it expired between two renewals, the session ended at the
 * identity provider): start the login again. Only for our own API calls. If the login was restarted a moment ago and
 * the server still says 401, something is wrong that another login will not fix; the error is passed on and the app
 * shows it, rather than redirecting forever.
 */
export const restartLoginOn401: HttpInterceptorFn = (request, next) => {
  const session = inject(SessionService);
  return next(request).pipe(
    catchError((error: unknown) => {
      if (
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        SECURE_ROUTES.some((route) => request.url.startsWith(route)) &&
        mayRestart()
      ) {
        session.restartLogin();
      }
      return throwError(() => error);
    }),
  );
};

function mayRestart(): boolean {
  try {
    const last = Number(sessionStorage.getItem(LAST_RESTART_KEY));
    if (Number.isFinite(last) && Date.now() - last < RESTART_COOLDOWN_MS) {
      return false;
    }
    sessionStorage.setItem(LAST_RESTART_KEY, String(Date.now()));
  } catch {
    // no storage: restart, the cooldown cannot be kept
  }
  return true;
}
