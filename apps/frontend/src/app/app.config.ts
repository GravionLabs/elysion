import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { authInterceptor } from 'angular-auth-oidc-client';
import { provideLogin } from './auth/provide-auth';
import { restartLoginOn401 } from './auth/restart-login-on-401';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // `authInterceptor` adds the access token to `/api` calls only (secureRoutes); `restartLoginOn401` starts the
    // login again when the API does not accept it.
    provideHttpClient(withInterceptors([restartLoginOn401, authInterceptor()])),
    provideLogin(),
    provideRouter(routes, withComponentInputBinding()),
  ],
};
