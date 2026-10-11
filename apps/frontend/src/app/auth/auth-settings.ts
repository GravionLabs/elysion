import type { OpenIdConfiguration } from 'angular-auth-oidc-client';

/** Where to log in and as which client: the deployment's part of the login configuration. */
export interface AuthSettings {
  /** The OpenID provider's issuer, e.g. `http://localhost:8081/realms/elysion`. */
  authority: string;
  /** The public client of the realm, `elysion-frontend`. */
  clientId: string;
  /**
   * Optional: the alias of the realm's identity provider (`microsoft`, ADR 0027). When set the login starts with
   * `kc_idp_hint=<alias>`, so Keycloak forwards to the company's login at once. Empty or absent: Keycloak's own page.
   */
  idpHint?: string;
}

/** An alias as Keycloak allows it; anything else is not passed on (the value comes from a deployment setting, but it ends up in a URL). */
const IDP_HINT = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Served by whatever hosts the app, so one build runs everywhere (`OIDC_ISSUER_URL` and `OIDC_CLIENT_ID` in the
 * container, `AUTH_IDP_HINT` for the optional `idpHint`, `public/auth-config.json` for `ng serve`).
 */
export const AUTH_SETTINGS_URL = '/auth-config.json';

/** The API calls that carry the access token. Nothing else does: the token is not for other servers. */
export const SECURE_ROUTES = ['/api'];

/**
 * The login configuration: authorization code flow with PKCE (a public client has no secret), refresh tokens for
 * silent renewal, and the redirects back to this app. `origin` is where the app is served from; the realm accepts
 * `http://localhost:4200/*` and `http://localhost/*`.
 */
export function buildOpenIdConfiguration(
  settings: AuthSettings,
  origin: string,
): OpenIdConfiguration {
  return {
    authority: settings.authority,
    clientId: settings.clientId,
    redirectUrl: origin,
    postLogoutRedirectUri: origin,
    responseType: 'code',
    scope: 'openid profile email',
    // Renew with the refresh token, not in a hidden iframe (no third-party-cookie problems).
    useRefreshToken: true,
    silentRenew: true,
    renewTimeBeforeTokenExpiresInSeconds: 30,
    // Names the user from the ID token, so no extra call to the userinfo endpoint is needed.
    autoUserInfo: false,
    secureRoutes: SECURE_ROUTES,
    ...(settings.idpHint && IDP_HINT.test(settings.idpHint)
      ? { customParamsAuthRequest: { kc_idp_hint: settings.idpHint } }
      : {}),
  };
}
