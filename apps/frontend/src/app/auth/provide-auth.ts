import { HttpClient } from '@angular/common/http';
import { type EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import {
  AbstractSecurityStorage,
  StsConfigHttpLoader,
  StsConfigLoader,
  provideAuth,
  withAppInitializerAuthCheck,
} from 'angular-auth-oidc-client';
import { map } from 'rxjs';
import { AUTH_SETTINGS_URL, type AuthSettings, buildOpenIdConfiguration } from './auth-settings';
import { TokenSafeStorage } from './token-safe-storage';

/**
 * The login (ADR 0016): the settings come from `/auth-config.json` when the app starts, the tokens are kept in
 * memory (`TokenSafeStorage`), and the callback of the identity provider is handled before the first route.
 *
 * The storage is registered **after** `provideAuth`, which registers its own `sessionStorage` default: a provider
 * that comes earlier is silently replaced by it, and the tokens would end up where a script on the page can read
 * them. Keeping both in this one function makes the order impossible to get wrong (and a test checks it).
 */
export function provideLogin(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideAuth(
      {
        loader: {
          provide: StsConfigLoader,
          useFactory: (http: HttpClient) =>
            new StsConfigHttpLoader(
              http
                .get<AuthSettings>(AUTH_SETTINGS_URL)
                .pipe(
                  map((settings) => buildOpenIdConfiguration(settings, window.location.origin)),
                ),
            ),
          deps: [HttpClient],
        },
      },
      withAppInitializerAuthCheck(),
    ),
    { provide: AbstractSecurityStorage, useClass: TokenSafeStorage },
  ]);
}
