import { describe, expect, it } from 'vitest';
import { SECURE_ROUTES, buildOpenIdConfiguration } from './auth-settings';

const settings = {
  authority: 'http://localhost:8081/realms/elysion',
  clientId: 'elysion-frontend',
};

describe('buildOpenIdConfiguration', () => {
  const config = buildOpenIdConfiguration(settings, 'http://localhost:4200');

  it('uses the authorization code flow, with the client of the realm', () => {
    expect(config).toMatchObject({
      authority: settings.authority,
      clientId: 'elysion-frontend',
      responseType: 'code',
      scope: 'openid profile email',
    });
  });

  it('comes back to the app and returns there after logging out', () => {
    expect(config.redirectUrl).toBe('http://localhost:4200');
    expect(config.postLogoutRedirectUri).toBe('http://localhost:4200');
  });

  it('renews silently with the refresh token', () => {
    expect(config).toMatchObject({ silentRenew: true, useRefreshToken: true });
  });

  it('sends the access token to the API only', () => {
    expect(config.secureRoutes).toEqual(['/api']);
    expect(SECURE_ROUTES).toEqual(['/api']);
  });

  it('has no client secret: the client is public and PKCE protects the flow', () => {
    expect(config).not.toHaveProperty('clientSecret');
  });

  it('follows where the app is served from', () => {
    expect(buildOpenIdConfiguration(settings, 'http://localhost').redirectUrl).toBe(
      'http://localhost',
    );
  });
});
