import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { Injector, inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { SECURE_ROUTES } from './auth-settings';

/** The `code` the BFF puts on the 403 of a deactivated account (the business backend's `account-deactivated`). */
export const ACCOUNT_DEACTIVATED = 'account-deactivated';

/** The address of the page that says so. */
export const DEACTIVATED_PATH = '/deactivated';

/**
 * A `403` with the code `account-deactivated` from our own API (#668) means an administrator has switched the account off: every call
 * would fail the same way, so the shell shows one page for it instead of an error in each place. A person who is on that page
 * already stays there (no loop). Any other `403` is passed on as it was.
 */
export const showDeactivatedPage: HttpInterceptorFn = (request, next) => {
  const injector = inject(Injector);
  return next(request).pipe(
    catchError((error: unknown) => {
      if (
        error instanceof HttpErrorResponse &&
        error.status === 403 &&
        (error.error as { code?: unknown } | null)?.code === ACCOUNT_DEACTIVATED &&
        SECURE_ROUTES.some((route) => request.url.startsWith(route))
      ) {
        const router = injector.get(Router);
        if (!router.url.startsWith(DEACTIVATED_PATH)) {
          void router.navigateByUrl(DEACTIVATED_PATH, { replaceUrl: true });
        }
      }
      return throwError(() => error);
    }),
  );
};
